const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Settings = require('../models/Settings');
const Property = require('../models/Property');
const { getToken, ttlockPost, CLIENT_ID } = require('../services/ttlockHelper');
const { formatAddress } = require('../utils/formatAddress');

function formatPropertyAddress(p) {
  if (!p) return '';
  const line1 = [p.hotelStreet, p.hotelStreetNo].filter(Boolean).join(' ');
  const line2 = [p.hotelCountry ? `${p.hotelCountry}-${p.hotelZip}` : p.hotelZip, p.hotelCity].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join('\n');
}

const { Types } = require('mongoose');
const TENANT_ID = new Types.ObjectId('507f1f77bcf86cd799439011');
const ENTRANCE_LOCK_ID = 3321320;

// Rate limiting: max 10 unlocks pro Token pro Tag
const unlockCounts = new Map();
function checkRateLimit(token) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${token}:${today}`;
  const count = unlockCounts.get(key) || 0;
  if (count >= 10) return false;
  unlockCounts.set(key, count + 1);
  // Cleanup alte Einträge
  for (const [k] of unlockCounts) {
    if (!k.endsWith(today)) unlockCounts.delete(k);
  }
  return true;
}

// GET /api/portal/:token — Buchungsdaten für Gast-Portal
router.get('/:token', async (req, res) => {
  try {
    const booking = await Booking.findOne({
      tenantId: TENANT_ID,
      guestPortalToken: req.params.token,
    });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    // Portal-Öffnung tracken (nicht Admin, nicht Hotel-IP)
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const isAdmin = !!req.headers.authorization;
    const trackSettings = await Settings.findOne({ tenantId: TENANT_ID }, 'adminIps').lean();
    const adminIps = trackSettings?.adminIps?.length ? trackSettings.adminIps : ['80.121.231.234', '85.25.46.31'];
    const isHotelIp = adminIps.includes(clientIp);
    if (!isAdmin && !isHotelIp) {
      await Booking.updateOne({ _id: booking._id }, { $set: { portalOpenedAt: new Date() }, $inc: { portalOpenCount: 1 } });
    }

    // Storniert oder gelöscht
    if (['cancelled', 'deleted'].includes(booking.status)) {
      return res.json({ success: false, error: 'cancelled' });
    }

    // Expired: checkOut + 24h überschritten
    const checkOutDate = new Date(booking.checkOut);
    checkOutDate.setHours(checkOutDate.getHours() + 24);
    if (new Date() > checkOutDate) {
      return res.json({ success: false, error: 'expired' });
    }

    // ── MASTER-BUCHUNG ERKENNUNG (Hybrid-Logik) ──────────────────────────────
    // Primär: Beds24-Master (OTA-Gruppen wie Cosic)
    const isBeds24Master = booking.beds24MasterId == null
                        && booking.beds24BookingId != null
                        && (await Booking.exists({
                             tenantId: booking.tenantId,
                             beds24MasterId: booking.beds24BookingId,
                           }));

    // Fallback: Direktbuchungs-Gruppen ohne Beds24
    const isSpecMaster = !!booking.groupId
                      && booking.bookedBy != null
                      && booking.guestId != null
                      && String(booking.bookedBy) === String(booking.guestId)
                      && (await Booking.exists({
                           tenantId: TENANT_ID,
                           groupId: booking.groupId,
                           _id: { $ne: booking._id },
                         }));

    const isMasterBooking = isBeds24Master || isSpecMaster;

    if (isMasterBooking) {
      const Guest = require('../models/Guest');

      // F3-Fix: hotelName für Master-Response laden
      const masterSettings = await Settings.findOne(
        { tenantId: TENANT_ID },
        'hotelName'
      ).lean();
      const masterProperty = booking.propertyId
        ? await Property.findOne({ _id: booking.propertyId, tenantId: TENANT_ID }, 'name').lean()
        : null;
      const hotelName = masterProperty?.name || masterSettings?.hotelName || '';

      // Master-Gast laden
      const masterGuestId = booking.guestId || booking.bookedBy;
      const masterGuest = masterGuestId
        ? await Guest.findOne({ _id: masterGuestId, tenantId: TENANT_ID }, 'firstName lastName').lean()
        : null;

      // Sub-Buchungen laden
      let subDocs;
      if (isBeds24Master) {
        subDocs = await Booking.find({
          tenantId: TENANT_ID,
          beds24MasterId: booking.beds24BookingId,
        }).lean();
      } else {
        subDocs = await Booking.find({
          tenantId: TENANT_ID,
          groupId: booking.groupId,
          _id: { $ne: booking._id },
        }).lean();
      }

      // Pro Sub-Buchung Guest laden
      const subBookings = await Promise.all(
        subDocs.map(async (sub) => {
          const subGuest = sub.guestId
            ? await Guest.findOne({ _id: sub.guestId, tenantId: TENANT_ID }, 'email phone firstName lastName').lean()
            : null;

          return {
            bookingId: sub._id.toString(),
            bookingCode: sub.bookingNumber,
            portalToken: sub.guestPortalToken,
            roomNumber: sub.roomName ?? null,
            roomType: sub.roomType ?? null,
            checkIn: sub.checkIn,
            checkOut: sub.checkOut,
            guestCount: (sub.persons ?? ((sub.adults || 0) + (sub.children || 0))) || 1,
            guest: {
              guestId: subGuest?._id?.toString() ?? null,
              email: subGuest?.email ?? null,
              phone: subGuest?.phone ?? null,
              firstName: subGuest?.firstName ?? null,
              lastName: subGuest?.lastName ?? null,
            },
            isOwnerRoom: sub.bookedBy != null && sub.guestId != null
                         && String(sub.bookedBy) === String(sub.guestId),
            checkInCompleted: sub.checkInCompleted ?? false,
            lastInviteSentAt: sub.lastInviteSentAt ?? null,
            lastInviteVia: sub.lastInviteVia ?? null,
          };
        })
      );

      // Sortieren nach roomNumber (roomName) numerisch-fähig
      subBookings.sort((a, b) =>
        (a.roomNumber ?? '').localeCompare(b.roomNumber ?? '', undefined, { numeric: true })
      );

      return res.json({
        success: true,
        data: {
          isMasterBooking: true,
          hotelName,
          bookerSleepsAtHotel: booking.bookerSleepsAtHotel ?? null,
          masterGuest: {
            firstName: masterGuest?.firstName ?? null,
            lastName: masterGuest?.lastName ?? null,
          },
          subBookings,
        },
      });
    }
    // ── ENDE MASTER-BUCHUNG ──────────────────────────────────────────────────

    const settings = await Settings.findOne(
      { tenantId: TENANT_ID },
      'hotelName hotelStreet hotelStreetNo hotelZip hotelCity hotelCountry hotelPhone hotelEmail hotelWebsite whatsapp receptionHours houseRules checkInTime checkOutTime googleMapsUrl portalConfig logoUrl'
    ).lean();

    // Property laden (Vorrang vor Settings)
    const property = booking.propertyId
      ? await Property.findOne({ _id: booking.propertyId, tenantId: TENANT_ID }).lean()
      : null;

    // Portal-Template laden (strukturierte Inhalte: welcomeText, checkInHint, houseRules)
    const EmailTemplate = require('../models/EmailTemplate');
    const Guest = require('../models/Guest');
    const hasCheckedIn = booking.checkInCompleted === true;
    const isPlaceholderProfile =
      booking.beds24MasterId != null &&
      booking.guestId != null &&
      booking.bookedBy != null &&
      String(booking.guestId) === String(booking.bookedBy) &&
      booking.checkInCompleted !== true;
    const guestLookupId = booking.guestId || booking.bookedBy;
    const guest = guestLookupId ? await Guest.findOne({ _id: guestLookupId, tenantId: TENANT_ID }, 'preferredLanguage email phone firstName lastName').lean() : null;
    const lang = (guest?.preferredLanguage === 'en') ? 'en' : 'de';
    const portalTpl = await EmailTemplate.findOne({ tenantId: TENANT_ID, type: 'portal' }).lean();
    const portalData = portalTpl?.data?.[lang] || portalTpl?.data?.de || {};
    const templateWelcome = portalData.welcomeText || '';
    const templateCheckInHint = portalData.checkInHint || '';
    const templateRules = Array.isArray(portalData.houseRules) ? portalData.houseRules : null;

    // Nächte berechnen
    const msPerDay = 86400000;
    const ci = new Date(booking.checkIn);
    const co = new Date(booking.checkOut);
    const nights = Math.round((co - ci) / msPerDay);

    // Gastname splitten — booking.guestName hat Vorrang, Fallback auf Guest-Profil
    const resolvedName = booking.guestName || (guest ? [guest.firstName, guest.lastName].filter(Boolean).join(' ') : '') || '';
    const nameParts = resolvedName.trim().split(/\s+/);
    const guestFirstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0] || '';

    res.json({
      success: true,
      data: {
        bookingNumber: booking.bookingNumber,
        guestName: hasCheckedIn ? booking.guestName : null,
        guestFirstName: isPlaceholderProfile ? null : (guestFirstName || null),
        guestEmailIsFake: (function(){ var e = (booking.contactEmail || (guest && guest.email) || "").toLowerCase(); return ["@guest.booking.com","@m.airbnb.com","@airbnb.com","@guest.expedia.com"].some(function(p){ return e.includes(p); }); })(),
        guestEmail: isPlaceholderProfile ? null : (function(){ var e = booking.contactEmail || (guest && guest.email) || ""; var fake = ["@guest.booking.com","@m.airbnb.com","@airbnb.com","@guest.expedia.com"].some(function(p){ return e.toLowerCase().includes(p); }); return fake ? null : (e || null); })(),
        guestPhone: isPlaceholderProfile ? null : (hasCheckedIn ? (guest?.phone || booking.contactPhone || null) : (booking.contactPhone || null)),
        roomName: booking.roomName,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights,
        doorCode: booking.doorAccess?.stayosCode || booking.doorAccess?.code || null,
        status: booking.status,
        roomLockId: booking.doorAccess?.roomLockId || null,
        roomUnlockSupported: true,
        hotelName: property?.name || settings?.hotelName || '',
        address: property ? formatPropertyAddress(property) : formatAddress(settings),
        googleMapsUrl: settings?.googleMapsUrl || '',
        whatsapp: property?.whatsapp || settings?.whatsapp || '',
        hotelPhone: property?.hotelPhone || settings?.hotelPhone || '',
        hotelEmail: settings?.hotelEmail || '',
        receptionHours: settings?.receptionHours || '',
        // Portal-Template hat Vorrang, dann Property, dann Settings
        houseRules: (templateRules && templateRules.length)
          ? templateRules
          : (property?.houseRules?.length ? property.houseRules : (settings?.houseRules || [])),
        welcomeText: templateWelcome || settings?.portalConfig?.welcomeText || '',
        checkInHint: templateCheckInHint || settings?.portalConfig?.checkInHint || '',
        checkInTime: property?.checkInTime || settings?.checkInTime || '15:00',
        checkOutTime: property?.checkOutTime || settings?.checkOutTime || '11:00',
        effectiveCheckInTime: booking.earlyCheckIn || property?.checkInTime || settings?.checkInTime || '15:00',
        effectiveCheckOutTime: booking.lateCheckOut || property?.checkOutTime || settings?.checkOutTime || '11:00',
        ci: (settings?.logoUrl || property?.ci)
          ? { ...(property?.ci || {}), logoUrl: settings?.logoUrl || property?.ci?.logoUrl || property?.logoUrl || '' }
          : null,
        checkInFormCompleted: booking.checkInForm?.completed === true || booking.checkInCompleted === true,
        checkInCompleted: booking.checkInCompleted === true,
        persons: booking.persons || (booking.adults || 0) + (booking.children || 0) || 1,
        legalPrivacyUrl: settings?.legal?.privacyUrl || null,
        legalImprintUrl: settings?.legal?.imprintUrl || null,
        isTest: booking.isTest === true,
        isPlaceholderProfile: isPlaceholderProfile,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/portal/:token/unlock — Tür öffnen
router.post('/:token/unlock', async (req, res) => {
  try {
    const { target } = req.body;
    if (!['room', 'entrance'].includes(target)) {
      return res.json({ success: false, error: 'target muss room oder entrance sein' });
    }

    const booking = await Booking.findOne({
      tenantId: TENANT_ID,
      guestPortalToken: req.params.token,
    });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    // Zeitfenster: checkIn-Tag ab effectiveCheckInTime (Vienna) <= jetzt <= checkOut-Tag + checkOutTime + 2h
    const now = new Date();
    const settings = await Settings.findOne({ tenantId: TENANT_ID }, 'checkInTime checkOutTime').lean();
    const ciTime = booking.earlyCheckIn || settings?.checkInTime || '15:00';
    const coTime = settings?.checkOutTime || '11:00';
    // Vienna Timezone korrekt: checkIn kann UTC-shifted sein (22:00 UTC = 00:00 Vienna)
    const { timeToUnix } = require('../services/ttlockService');
    const toViennaDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
    const ciStr = toViennaDate(booking.checkIn);
    const coStr = toViennaDate(booking.checkOut);
    const checkInStartMs = timeToUnix(ciStr, ciTime);
    const checkOutEndMs = timeToUnix(coStr, coTime) + 2 * 3600000; // +2h Buffer
    if (now.getTime() < checkInStartMs) {
      return res.json({ success: false, error: 'too_early', message: `Türöffnung ab ${ciTime} Uhr am Anreisetag möglich` });
    }
    if (now.getTime() > checkOutEndMs) {
      return res.json({ success: false, error: 'too_late', message: 'Aufenthalt beendet — Türöffnung nicht mehr möglich' });
    }

    // Rate limit
    if (!checkRateLimit(req.params.token)) {
      return res.json({ success: false, error: 'Tageslimit erreicht (max 10 Unlocks)' });
    }

    const lockId = target === 'room' ? booking.doorAccess?.roomLockId : ENTRANCE_LOCK_ID;
    if (!lockId) return res.json({ success: false, error: 'Kein Schloss zugeordnet' });

    const token = await getToken();
    const result = await ttlockPost('/v3/lock/unlock', {
      clientId: CLIENT_ID,
      accessToken: token,
      lockId,
      date: Date.now(),
    });

    if (result.errcode) {
      return res.json({ success: false, error: result.errmsg || `Fehler ${result.errcode}` });
    }

    res.json({ success: true, message: target === 'room' ? 'Zimmer geöffnet' : 'Haupteingang geöffnet' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// PATCH /api/portal/:token/checkin-form — Guest Self Check-in
router.patch('/:token/checkin-form', async (req, res) => {
  try {
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: req.params.token });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    const Guest = require('../models/Guest');
    const Company = require('../models/Company');
    const f = req.body;

    // Guest updaten
    if (booking.guestId) {
      const guestUpdate = {
        'address.street': f.street || undefined,
        'address.streetNo': f.streetNo || undefined,
        'address.zip': f.zip || undefined,
        'address.city': f.city || undefined,
        'address.country': f.country || undefined,
        documentType: f.documentType || undefined,
        nationality: f.nationality || undefined,
        documentNumber: f.documentNumber || undefined,
        birthDate: f.birthDate || undefined,
        passportExpiry: f.passportExpiry || undefined,
        businessGuest: !!f.isBusiness,
      };
      // Remove undefined
      Object.keys(guestUpdate).forEach(k => guestUpdate[k] === undefined && delete guestUpdate[k]);
      // Cross-tenant: Guest kann plattformübergreifend sein, raw collection bypassed tenantId plugin
      const mongoose = require('mongoose');
      const guestCol = mongoose.connection.db.collection('guests');
      await guestCol.updateOne({ _id: booking.guestId }, { $set: guestUpdate });

      // Company
      if (f.isBusiness && f.companyName) {
        let company = await Company.findOne({ tenantId: TENANT_ID, $or: [{ name: f.companyName }, { vatId: f.companyUid }].filter(q => q.name || q.vatId) });
        if (!company) {
          company = await Company.create({
            tenantId: TENANT_ID,
            name: f.companyName,
            vatId: f.companyUid || undefined,
            address: { street: f.companyStreet, streetNo: f.companyStreetNo, zip: f.companyZip, city: f.companyCity, country: f.companyCountry },
            invoiceEmail: f.companyEmail || undefined,
          });
        }
        await guestCol.updateOne({ _id: booking.guestId }, { $set: { companyId: company._id, companyName: company.name } });
        await Booking.updateOne({ _id: booking._id }, { $set: { companyId: company._id } });
      }
    }

    // Booking checkin form
    await Booking.updateOne({ _id: booking._id }, { $set: {
      'checkInForm.completed': true,
      'checkInForm.completedAt': new Date(),
      'checkInForm.street': f.street,
      'checkInForm.zip': f.zip,
      'checkInForm.city': f.city,
      'checkInForm.country': f.country,
      'checkInForm.isBusiness': !!f.isBusiness,
      'checkInForm.companyName': f.companyName || null,
      'checkInForm.companyUid': f.companyUid || null,
      'checkInForm.documentType': f.documentType,
      'checkInForm.nationality': f.nationality,
      'checkInForm.documentNumber': f.documentNumber,
    }});

    const updated = await Booking.findOne({ _id: booking._id, tenantId: TENANT_ID }).lean();
    res.json({ success: true, doorCode: updated.doorAccess?.stayosCode || updated.doorAccess?.code || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ─── Check-in Flow ───────────────────────────────────────────────────────────

// POST /api/portal/:token/lookup — Email-Lookup tenant-übergreifend
router.post('/:token/lookup', async (req, res) => {
  try {
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: req.params.token });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'email fehlt' });

    // Cross-tenant lookup (Doctolib-Prinzip) — raw collection to bypass tenantId plugin
    const guestCol = require('mongoose').connection.db.collection('guests');
    const guest = await guestCol.findOne(
      { email, status: { $ne: 'anonymized' } },
      { projection: { firstName: 1, lastName: 1, birthDate: 1, nationality: 1, documentNumber: 1, phone: 1, address: 1, preferredLanguage: 1, platformConsent: 1, cityOfBirth: 1, documentType: 1, passportExpiry: 1 } }
    );

    if (!guest || !guest.platformConsent) {
      return res.json({ success: true, found: false });
    }

    res.json({
      success: true,
      found: true,
      platformConsent: guest.platformConsent,
      data: {
        firstName: guest.firstName,
        lastName: guest.lastName,
        dateOfBirth: guest.birthDate,
        nationality: guest.nationality,
        documentNumber: guest.documentNumber,
        phone: guest.phone,
        street: guest.address?.street || '',
        postalCode: guest.address?.zip || '',
        city: guest.address?.city || '',
        country: guest.address?.country || '',
        language: guest.preferredLanguage || 'de',
        cityOfBirth: guest.cityOfBirth || '',
        documentType: guest.documentType || 'id_card',
        passportExpiry: guest.passportExpiry || null,
        streetNo: guest.address?.streetNo || '',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/portal/:token/checkin — Check-in abschließen
router.post('/:token/checkin', async (req, res) => {
  try {
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: req.params.token });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    // Token abgelaufen?
    if (booking.guestPortalTokenExpiry && new Date() > booking.guestPortalTokenExpiry) {
      return res.status(410).json({ success: false, error: 'expired' });
    }

    // Bereits eingecheckt?
    if (booking.checkInCompleted) {
      return res.json({
        success: true,
        alreadyCompleted: true,
        doorCode: booking.doorAccess?.stayosCode || null,
      });
    }

    const { guestData, invoiceRecipient, platformConsent, magicToken } = req.body;
    if (!guestData?.firstName || !guestData?.lastName || !guestData?.email) {
      return res.status(400).json({ success: false, error: 'Pflichtfelder fehlen' });
    }
    const allowedDocTypes = ['passport', 'id_card'];
    if (!allowedDocTypes.includes(guestData.documentType)) {
      return res.status(400).json({ success: false, error: 'Ungültiger Dokumenttyp' });
    }
    if (guestData.nationality !== 'AT' && !guestData.cityOfBirth) {
      return res.status(400).json({ success: false, error: 'Geburtsort Pflichtfeld für nicht-AT Gäste' });
    }
    if (!guestData.passportExpiry) {
      return res.status(400).json({ success: false, error: 'Ablaufdatum Pflichtfeld' });
    }

    const Guest = require('../models/Guest');
    const mongoose = require('mongoose');
    const guestCol = mongoose.connection.db.collection('guests');

    // Same-tenant lookup per Email
    let existingGuest = null;
    if (guestData.email && guestData.email.trim()) {
      existingGuest = await guestCol.findOne({
        email: guestData.email.trim().toLowerCase(),
        tenantId: TENANT_ID,
        status: { $ne: 'anonymized' }
      });
    }
    // TODO eigene Session: phoneNormalized als zweiter Lookup-Schlüssel

    // Stück 2: existingGuest ohne Magic Token → 403 block (S3B-Schutz)
    if (existingGuest && !magicToken) {
      return res.status(403).json({ success: false, error: 'magic_link_required' });
    }
    // Stück 2: existingGuest mit Magic Token → verifizieren + usedAt setzen
    if (existingGuest && magicToken) {
      const MagicToken = require('../models/MagicToken');
      const mtDoc = await MagicToken.findOne({ token: magicToken, bookingId: booking._id, tenantId: TENANT_ID });
      if (!mtDoc || mtDoc.expiresAt < new Date() || mtDoc.usedAt != null) {
        return res.status(410).json({ success: false, error: 'magic_token_invalid' });
      }
      await MagicToken.updateOne({ _id: mtDoc._id }, { $set: { usedAt: new Date() } });
    }

    let guestId;

    if (existingGuest) {
      // Bestehenden Gast updaten via raw collection (bypassed tenantId plugin)
      // firstName + lastName nie überschreiben bei bestehendem Profil
      const updateFields = {
        updatedAt: new Date(),
        email: guestData.email,
        emailIsReal: true,
        emailIsRealSince: new Date(),
        emailIsFake: false
      };
      if (guestData.phone) updateFields.phone = guestData.phone;
      if (guestData.nationality) updateFields.nationality = guestData.nationality;
      if (guestData.documentNumber) updateFields.documentNumber = guestData.documentNumber;
      if (guestData.documentType) updateFields.documentType = guestData.documentType;
      if (guestData.dateOfBirth) updateFields.birthDate = new Date(guestData.dateOfBirth);
      if (guestData.passportExpiry) updateFields.passportExpiry = new Date(guestData.passportExpiry);
      if (guestData.cityOfBirth) updateFields.cityOfBirth = guestData.cityOfBirth;
      if (guestData.language) updateFields.preferredLanguage = guestData.language;
      if (platformConsent !== undefined) updateFields.platformConsent = platformConsent;
      if (platformConsent) updateFields.platformConsentDate = new Date();

      // Änderungen loggen
      const trackFields = { phone: 'phone', nationality: 'nationality', documentNumber: 'documentNumber' };
      const addressFields = { street: 'address.street', streetNo: 'address.streetNo', postalCode: 'address.zip', city: 'address.city', country: 'address.country' };
      const historyEntries = [];
      for (const [formKey, dbKey] of Object.entries(trackFields)) {
        const newVal = guestData[formKey];
        const oldVal = existingGuest[formKey];
        if (newVal && String(newVal) !== String(oldVal || '')) {
          historyEntries.push({ modifiedAt: new Date(), modifiedBy: 'self', modifiedField: formKey, oldValue: String(oldVal || ''), newValue: String(newVal), reason: 'checkin_update' });
        }
      }
      for (const [formKey, dbPath] of Object.entries(addressFields)) {
        const newVal = guestData[formKey];
        const parts = dbPath.split('.');
        const oldVal = parts.length === 2 ? (existingGuest[parts[0]] || {})[parts[1]] : existingGuest[parts[0]];
        if (newVal && String(newVal) !== String(oldVal || '')) {
          historyEntries.push({ modifiedAt: new Date(), modifiedBy: 'self', modifiedField: dbPath, oldValue: String(oldVal || ''), newValue: String(newVal), reason: 'checkin_update' });
        }
      }
      if (guestData.street) {
        updateFields.address = {
          street: guestData.street,
          streetNo: guestData.streetNo || '',
          zip: guestData.postalCode,
          city: guestData.city,
          country: guestData.country,
        };
      }
      // Tenant hinzufügen wenn nicht vorhanden
      const hasTenant = (existingGuest.tenants || []).some(t => String(t.tenantId) === TENANT_ID);
      if (hasTenant) {
        await guestCol.updateOne({ _id: existingGuest._id }, { $set: updateFields, ...(historyEntries.length ? { $push: { modificationHistory: { $each: historyEntries } } } : {}) });
      } else {
        await guestCol.updateOne({ _id: existingGuest._id }, {
          $set: updateFields,
          $push: { tenants: { tenantId: TENANT_ID, consent: true, since: new Date() }, ...(historyEntries.length ? { modificationHistory: { $each: historyEntries } } : {}) },
        });
      }
      guestId = existingGuest._id;
    } else {
      // Neuen Gast erstellen via Mongoose (braucht tenantId)
      const crypto = require('crypto');
      const guest = new Guest({
        tenantId: TENANT_ID,
        firstName: guestData.firstName,
        lastName: guestData.lastName,
        email: guestData.email,
        emailIsReal: true,
        emailIsRealSince: new Date(),
        emailIsFake: false,
        phone: guestData.phone,
        birthDate: guestData.dateOfBirth ? new Date(guestData.dateOfBirth) : null,
        passportExpiry: guestData.passportExpiry ? new Date(guestData.passportExpiry) : null,
        cityOfBirth: guestData.cityOfBirth || '',
        nationality: guestData.nationality,
        documentNumber: guestData.documentNumber,
        preferredLanguage: guestData.language || 'de',
        address: {
          street: guestData.street,
          streetNo: guestData.streetNo || '',
          zip: guestData.postalCode,
          city: guestData.city,
          country: guestData.country,
        },
        platformConsent: platformConsent || false,
        platformConsentDate: platformConsent ? new Date() : null,
        gdprConsent: true,
        gdprConsentDate: new Date(),
        tenants: [{ tenantId: TENANT_ID, consent: true, since: new Date() }],
      });
      await guest.save();
      guestId = guest._id;
    }

    // Firma verarbeiten
    if (invoiceRecipient?.type === 'company') {
      const Company = require('../models/Company');
      let company = invoiceRecipient.vatId
        ? await Company.findOne({ tenantId: TENANT_ID, vatId: invoiceRecipient.vatId })
        : null;
      if (!company) {
        company = new Company({
          tenantId: TENANT_ID,
          name: invoiceRecipient.companyName,
          vatId: invoiceRecipient.vatId || '',
          address: invoiceRecipient.address,
          viesVerified: invoiceRecipient.viesVerified || false,
        });
        await company.save();
      }
      booking.invoiceRecipient = {
        type: 'company',
        companyId: company._id,
        companyName: company.name,
        vatId: company.vatId,
        address: company.address,
        viesVerified: company.viesVerified,
        verifiedAt: new Date(),
      };
      if (guestId) {
        await Guest.updateOne({ _id: guestId }, { $set: { businessGuest: true, companyName: company.name, companyId: company._id } });
      }
    } else {
      booking.invoiceRecipient = { type: 'private' };
    }

    // Booking abschließen
    const checkedInGuest = await guestCol.findOne({ _id: guestId }, { firstName: 1, lastName: 1 });
    booking.guestId = guestId;
    booking.guestName = `${checkedInGuest?.firstName || guestData.firstName} ${checkedInGuest?.lastName || guestData.lastName}`.trim();
    booking.checkInCompleted = true;
    booking.checkedInAt = new Date();
    booking.checkinMethod = 'portal';
    booking.manualOverride = true; // Sync darf Portal-Check-in nicht überschreiben
    if (req.body.consentData) {
      booking.consentData = {
        ...req.body.consentData,
        ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
      };
    }
    booking.checkInForm = {
      completed: true,
      completedAt: new Date(),
      street: guestData.street,
      streetNo: guestData.streetNo || '',
      zip: guestData.postalCode,
      city: guestData.city,
      country: guestData.country,
      nationality: guestData.nationality,
      documentNumber: guestData.documentNumber,
      birthDate: guestData.dateOfBirth || null,
      passportExpiry: guestData.passportExpiry || null,
      cityOfBirth: guestData.cityOfBirth || '',
      isBusiness: invoiceRecipient?.type === 'company',
      companyName: invoiceRecipient?.companyName || '',
      companyUid: invoiceRecipient?.vatId || '',
    };
    await booking.save();

    // Companions verarbeiten wenn mitgeschickt
    if (req.body.companions && Array.isArray(req.body.companions) && req.body.companions.length > 0) {
      const crypto = require('crypto');
      const companionDocs = [];
      for (const comp of req.body.companions) {
        const dob = comp.dateOfBirth ? new Date(comp.dateOfBirth) : null;
        const checkInDate = new Date(booking.checkIn);
        const ageAtCheckin = dob ? Math.floor((checkInDate - dob) / (365.25 * 24 * 60 * 60 * 1000)) : null;
        const stgCode = crypto.randomBytes(3).toString('hex').toUpperCase();
        const companion = new Guest({
          tenantId: TENANT_ID,
          firstName: comp.firstName,
          lastName: comp.lastName,
          birthDate: dob,
          stayosGuestId: 'STG-' + stgCode,
          primaryGuestId: guestId,
          relationship: 'family_member',
          isIndependent: false,
          platformConsent: false,
          gdprConsent: true,
          gdprConsentDate: new Date(),
          tenants: [{ tenantId: TENANT_ID, consent: false, since: new Date() }],
        });
        await companion.save();
        companionDocs.push({ guestId: companion._id, isCityTaxExempt: ageAtCheckin !== null && ageAtCheckin < 14, ageAtCheckin });
        await guestCol.updateOne({ _id: guestId }, { $push: { companions: { guestId: companion._id, addedAt: new Date(), addedViaBookingId: booking._id } } });
      }
      booking.companions = companionDocs;
      booking.primaryGuestId = guestId;
      await booking.save();
    }

    // Guest bookings Array aktualisieren
    await guestCol.updateOne({ _id: guestId }, { $addToSet: { bookings: booking._id } });

    res.json({
      success: true,
      doorCode: booking.doorAccess?.stayosCode || null,
      codeValidFrom: booking.checkIn,
      codeValidUntil: booking.checkOut,
      guestName: guestData.firstName + ' ' + guestData.lastName,
    });
  } catch (err) {
    console.error('[Portal Checkin]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});



// POST /api/portal/:token/checkin-companions
router.post('/:token/checkin-companions', async (req, res) => {
  try {
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: req.params.token });
    if (!booking) return res.status(404).json({ error: 'Not found' });

    const { companions } = req.body;
    if (!companions || !Array.isArray(companions)) return res.status(400).json({ error: 'companions required' });

    const Guest = require('../models/Guest');
    const crypto = require('crypto');
    const mongoose = require('mongoose');
    const guestCol = mongoose.connection.db.collection('guests');
    const companionDocs = [];

    for (const c of companions) {
      const dob = c.dateOfBirth ? new Date(c.dateOfBirth) : null;
      const checkInDate = new Date(booking.checkIn);
      const ageAtCheckin = dob ? Math.floor((checkInDate - dob) / (365.25 * 24 * 60 * 60 * 1000)) : null;

      const stgCode = crypto.randomBytes(3).toString('hex').toUpperCase();
      const companion = new Guest({
        tenantId: TENANT_ID,
        firstName: c.firstName,
        lastName: c.lastName,
        birthDate: dob,
        stayosGuestId: 'STG-' + stgCode,
        primaryGuestId: booking.guestId,
        relationship: 'family_member',
        isIndependent: false,
        platformConsent: false,
        gdprConsent: true,
        gdprConsentDate: new Date(),
        tenants: [{ tenantId: TENANT_ID, consent: false, since: new Date() }],
      });
      await companion.save();

      companionDocs.push({
        guestId: companion._id,
        isCityTaxExempt: ageAtCheckin !== null && ageAtCheckin < 14,
        ageAtCheckin,
      });

      // Link companion to primary guest
      await guestCol.updateOne(
        { _id: booking.guestId },
        { $push: { companions: { guestId: companion._id, addedAt: new Date(), addedViaBookingId: booking._id } } }
      );
    }

    booking.companions = companionDocs;
    booking.primaryGuestId = booking.guestId;
    await booking.save();

    res.json({ success: true, count: companionDocs.length });
  } catch (err) {
    console.error('[Portal Companions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Magic Link Flow ──────────────────────────────────────────────────────────

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return local.charAt(0) + '***@' + domain;
}

// POST /api/portal/:token/request-magic-link — Magic Link per Email anfordern
router.post('/:token/request-magic-link', async (req, res) => {
  try {
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: req.params.token });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    // Booking-Status prüfen: nicht cancelled/deleted, nicht expired
    if (['cancelled', 'deleted'].includes(booking.status)) {
      return res.json({ success: false, error: 'cancelled' });
    }
    const checkOutDate = new Date(booking.checkOut);
    checkOutDate.setHours(checkOutDate.getHours() + 24);
    if (new Date() > checkOutDate) {
      return res.json({ success: false, error: 'expired' });
    }

    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'email fehlt' });
    }
    const normalizedEmail = email.trim().toLowerCase();

    // Same-tenant Guest-Lookup
    const mongoose = require('mongoose');
    const guestCol = mongoose.connection.db.collection('guests');
    const guest = await guestCol.findOne({
      email: normalizedEmail,
      tenantId: TENANT_ID,
      status: { $ne: 'anonymized' },
    });

    if (!guest) {
      return res.json({ success: true, sent: false });
    }

    // MagicToken erstellen (32 Bytes random hex, expiresAt = now + 30 Min)
    const crypto = require('crypto');
    const MagicToken = require('../models/MagicToken');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await MagicToken.create({
      token,
      guestId: guest._id,
      bookingId: booking._id,
      tenantId: TENANT_ID,
      expiresAt,
    });

    const { sendMagicLinkEmail } = require('../services/magicLinkEmailService');
    const settings = await Settings.findOne({ tenantId: TENANT_ID }, 'hotelName').lean();
    await sendMagicLinkEmail({
      tenantId: TENANT_ID,
      guestId: guest._id,
      bookingToken: booking.guestPortalToken,
      magicToken: token,
      hotelName: settings?.hotelName || '',
      lang: booking.communication?.language || guest.preferredLanguage || 'de',
    });

    return res.json({ success: true, sent: true, maskedEmail: maskEmail(normalizedEmail) });
  } catch (err) {
    console.error('[Portal MagicLink Request]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/portal/:token/magic/:magicToken — Magic Token einlösen, Gast-Daten zurückgeben
router.get('/:token/magic/:magicToken', async (req, res) => {
  try {
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: req.params.token });
    if (!booking) return res.json({ success: false, error: 'not_found' });

    const MagicToken = require('../models/MagicToken');
    const magicTokenDoc = await MagicToken.findOne({
      token: req.params.magicToken,
      bookingId: booking._id,
      tenantId: TENANT_ID,
    });

    // Prüfungen: existiert, nicht expired, nicht bereits verwendet
    if (
      !magicTokenDoc ||
      magicTokenDoc.expiresAt <= new Date() ||
      magicTokenDoc.usedAt !== null
    ) {
      return res.status(410).json({ success: false, error: 'magic_token_invalid' });
    }

    // Gast-Profil laden
    const mongoose = require('mongoose');
    const guestCol = mongoose.connection.db.collection('guests');
    const guest = await guestCol.findOne({ _id: magicTokenDoc.guestId });
    if (!guest) {
      return res.status(410).json({ success: false, error: 'magic_token_invalid' });
    }

    return res.json({
      success: true,
      guestData: {
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email || null,
        dateOfBirth: guest.birthDate,
        nationality: guest.nationality,
        documentNumber: guest.documentNumber,
        documentType: guest.documentType || 'id_card',
        passportExpiry: guest.passportExpiry,
        phone: guest.phone,
        street: guest.address?.street || '',
        streetNo: guest.address?.streetNo || '',
        postalCode: guest.address?.zip || '',
        city: guest.address?.city || '',
        country: guest.address?.country || '',
        cityOfBirth: guest.cityOfBirth || '',
        language: guest.preferredLanguage || 'de',
      },
    });
  } catch (err) {
    console.error('[Portal MagicLink Verify]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/portal/:masterToken/master/sub/:subBookingCode — Sub-Gast Email/Phone setzen und Einladung versenden
router.patch('/:masterToken/master/sub/:subBookingCode', async (req, res) => {
  try {
    const Guest = require('../models/Guest');
    const { masterToken, subBookingCode } = req.params;
    const { email, phone, send } = req.body;

    // 1. Master-Buchung per Token laden
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: masterToken });
    if (!booking) return res.status(404).json({ error: 'not_found' });

    // 2. Prüfen ob Master-Buchung (Beds24-Pfad)
    const isBeds24Master = booking.beds24MasterId == null
                        && booking.beds24BookingId != null
                        && (await Booking.exists({
                             tenantId: TENANT_ID,
                             beds24MasterId: booking.beds24BookingId,
                           }));
    if (!isBeds24Master) return res.status(403).json({ error: 'not_master' });

    // 3. Sub-Buchung laden — Beds24-Pfad zuerst, dann groupId-Fallback
    let sub = await Booking.findOne({
      tenantId: TENANT_ID,
      beds24MasterId: booking.beds24BookingId,
      bookingNumber: subBookingCode,
    });
    if (!sub && booking.groupId) {
      sub = await Booking.findOne({
        tenantId: TENANT_ID,
        groupId: booking.groupId,
        bookingNumber: subBookingCode,
      });
    }
    if (!sub) return res.status(404).json({ error: 'sub_not_found' });

    // 4. Email-Uniqueness prüfen (nur wenn email im Body)
    if (email !== undefined) {
      // Alle anderen Sub-Buchungen der Gruppe laden (gleicher Pfad wie oben)
      let otherSubs;
      if (isBeds24Master) {
        otherSubs = await Booking.find({
          tenantId: TENANT_ID,
          beds24MasterId: booking.beds24BookingId,
          _id: { $ne: sub._id },
        }).lean();
      } else {
        otherSubs = await Booking.find({
          tenantId: TENANT_ID,
          groupId: booking.groupId,
          _id: { $ne: sub._id },
        }).lean();
      }

      // GuestIds der anderen Subs (nicht null, nicht die aktuelle Sub)
      const otherGuestIds = otherSubs
        .map(s => s.guestId)
        .filter(id => id != null);

      // Master-guestId immer einschließen (auch im Reisebüro-Fall wo sub.guestId === master.guestId):
      // Im Reisebüro-Fall zeigt sub.guestId auf denselben Guest wie booking.guestId — der Master-Guest
      // muss trotzdem in der Uniqueness-Prüfung bleiben, da er ein eigenständiges Profil ist.
      // Die Bedingung prüft ob booking.guestId bereits via otherSubs abgedeckt ist; falls nicht, manuell hinzufügen.
      if (booking.guestId) {
        const masterAlreadyIncluded = otherGuestIds.some(id => String(id) === String(booking.guestId));
        if (!masterAlreadyIncluded) {
          otherGuestIds.push(booking.guestId);
        }
      }

      if (otherGuestIds.length > 0) {
        const conflictGuest = await Guest.findOne({
          tenantId: TENANT_ID,
          email: email,
          _id: { $in: otherGuestIds },
          status: { $ne: 'anonymized' },
        }).lean();

        if (conflictGuest) {
          // conflictingBookingCode aus otherSubs ermitteln
          const conflictSub = otherSubs.find(s => s.guestId && String(s.guestId) === String(conflictGuest._id));
          return res.status(409).json({
            error: 'email_already_assigned',
            conflictingBookingCode: conflictSub?.bookingNumber ?? null,
          });
        }
      }
    }

    // 5. Reisebüro-Pattern prüfen: Sub verwendet Master-Guest → neuen Sub-Guest anlegen
    // Wenn sub.guestId === master.bookedBy (Reisebüro) oder sub hat keinen eigenen Guest (null),
    // darf der Master-Guest NIEMALS direkt beschrieben werden.
    const emailFromBody = email;
    const phoneFromBody = phone;
    const isUsingMasterGuest = sub.guestId != null && booking.bookedBy != null
                             && sub.guestId.equals(booking.bookedBy);
    const isEmpty = !sub.guestId;

    let guest;
    let needsGuestSave = false;
    if (isUsingMasterGuest || isEmpty) {
      // Neuen leeren Sub-Guest anlegen — stayosGuestId wird automatisch via pre-save Hook generiert
      const newSubGuest = await Guest.create({
        tenantId: TENANT_ID,
        email: emailFromBody || null,
        phone: phoneFromBody || null,
        firstName: '',
        lastName: '',
        status: 'active',
      });

      try {
        const bookingUpdate = await Booking.updateOne(
          { _id: sub._id, tenantId: TENANT_ID },
          { $set: { guestId: newSubGuest._id } }
        );
        if (bookingUpdate.modifiedCount === 0) {
          // Booking nicht gefunden/geändert — Orphan-Guest aufräumen
          await Guest.deleteOne({ _id: newSubGuest._id }).catch(() => {});
          return res.status(500).json({ error: 'Booking update failed' });
        }
      } catch (updateErr) {
        // Best-effort Cleanup — Fehler beim Cleanup ignorieren
        await Guest.deleteOne({ _id: newSubGuest._id }).catch(() => {});
        throw updateErr; // Weiterwerfen damit der äußere catch 500 zurückgibt
      }

      // sub.guestId lokal aktualisieren (für Response und Idempotenz)
      sub.guestId = newSubGuest._id;
      guest = newSubGuest;
    } else {
      // Sub hat bereits eigenen Sub-Guest — Email/Phone direkt updaten
      guest = await Guest.findById(sub.guestId);
      if (!guest) {
        // Konsistenzproblem: guestId gesetzt aber Dokument fehlt — neuen anlegen
        guest = await Guest.create({
          tenantId: TENANT_ID,
          email: emailFromBody || null,
          phone: phoneFromBody || null,
          firstName: '',
          lastName: '',
          status: 'active',
        });
        await Booking.updateOne(
          { _id: sub._id, tenantId: TENANT_ID },
          { $set: { guestId: guest._id } }
        );
        sub.guestId = guest._id;
      } else {
        // Bestehenden Sub-Guest updaten
        if (emailFromBody !== undefined) guest.email = emailFromBody;
        if (phoneFromBody !== undefined) guest.phone = phoneFromBody;
        needsGuestSave = true;
      }
    }

    // 6. Idempotenz-Schutz (nur wenn send im Body)
    if (send) {
      if (sub.lastInviteSentAt) {
        const elapsed = Date.now() - new Date(sub.lastInviteSentAt).getTime();
        if (elapsed < 60_000) {
          return res.status(429).json({
            error: 'too_soon',
            retryAfterSeconds: Math.ceil((60_000 - elapsed) / 1000),
          });
        }
      }
    }

    // 7. Versand
    if (send) {
      const language = send.language || 'de';

      if (send.channel === 'email') {
        // Email muss vorhanden sein (aus Body oder schon gesetzt)
        const toEmail = guest.email;
        if (!toEmail) {
          return res.status(400).json({ error: 'email_required_for_email_channel' });
        }

        // Master-Gast laden für bookerName
        const masterGuestId = booking.guestId || booking.bookedBy;
        const masterGuest = masterGuestId
          ? await Guest.findOne({ _id: masterGuestId, tenantId: TENANT_ID }, 'firstName').lean()
          : null;
        const bookerName = masterGuest?.firstName || 'Dein Gastgeber';

        const { sendInvite } = require('../services/subPortalInviteEmailService');
        await sendInvite({
          toEmail,
          language,
          subPortalToken: sub.guestPortalToken,
          bookerName,
          tenantId: TENANT_ID,
        });

        sub.lastInviteSentAt = new Date();
        sub.lastInviteVia = 'email';

      } else if (send.channel === 'whatsapp') {
        // Kein Backend-Versand — nur Timestamp setzen
        sub.lastInviteSentAt = new Date();
        sub.lastInviteVia = 'whatsapp';
      }
    }

    // 8. Speichern
    await sub.save();
    if (needsGuestSave) await guest.save();

    // 9. Response 200
    return res.json({
      bookingId: sub._id.toString(),
      bookingCode: sub.bookingNumber,
      portalToken: sub.guestPortalToken,
      roomNumber: sub.roomName ?? null,
      guest: {
        guestId: guest._id.toString(),
        email: guest.email ?? null,
        phone: guest.phone ?? null,
        firstName: guest.firstName ?? null,
        lastName: guest.lastName ?? null,
      },
      isOwnerRoom: sub.bookedBy != null && sub.guestId != null
                   && String(sub.bookedBy) === String(sub.guestId),
      checkInCompleted: sub.checkInCompleted ?? false,
      lastInviteSentAt: sub.lastInviteSentAt ?? null,
      lastInviteVia: sub.lastInviteVia ?? null,
    });
  } catch (err) {
    console.error('[Portal Sub PATCH]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/portal/:masterToken/master/sleeps-at-hotel — Booker-Schlaf-Status setzen + Cosic-Cleanup
router.post('/:masterToken/master/sleeps-at-hotel', async (req, res) => {
  try {
    const { masterToken } = req.params;
    const { bookerSleepsAtHotel, ownSubBookingCode } = req.body;

    // 1. Master-Buchung per Token laden
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: masterToken });
    if (!booking) return res.status(404).json({ error: 'not_found' });

    // 2. Master-Check (isBeds24Master)
    const isBeds24Master = booking.beds24MasterId == null
                        && booking.beds24BookingId != null
                        && (await Booking.exists({
                             tenantId: TENANT_ID,
                             beds24MasterId: booking.beds24BookingId,
                           }));
    if (!isBeds24Master) return res.status(403).json({ error: 'not_master' });

    // 3. bookerSleepsAtHotel validieren
    if (typeof bookerSleepsAtHotel !== 'boolean') {
      return res.status(400).json({ error: 'invalid_input' });
    }
    // Fix K2: ownSubBookingCode ist bei bookerSleepsAtHotel=false nicht erlaubt
    if (bookerSleepsAtHotel === false && ownSubBookingCode != null) {
      return res.status(400).json({ error: 'ownSubBookingCode_not_allowed_when_not_sleeping' });
    }

    // 4. Alle Sub-Buchungen laden
    const subs = await Booking.find({ tenantId: TENANT_ID, beds24MasterId: booking.beds24BookingId });

    // 5. + 6. Cosic-Datenrest aufräumen und ggf. ownSub setzen
    let ownSub = null;
    if (bookerSleepsAtHotel === true && ownSubBookingCode) {
      ownSub = subs.find(s => s.bookingNumber === ownSubBookingCode);
      if (!ownSub) return res.status(400).json({ error: 'invalid_sub_booking_code' });
    }

    let cleanedUp = 0;
    const subUpdates = []; // { _id, guestId } für updateOne-Calls
    for (const sub of subs) {
      // Schritt 5: Subs wo bookedBy === master.bookedBy auf null setzen — AUSSER ownSub
      if (
        booking.bookedBy != null &&
        sub.bookedBy != null &&
        String(sub.bookedBy) === String(booking.bookedBy)
      ) {
        if (ownSub && String(sub._id) === String(ownSub._id)) {
          // Schritt 6: ownSub bekommt master.bookedBy als guestId
          ownSub.guestId = booking.bookedBy;
          subUpdates.push({ _id: sub._id, guestId: booking.bookedBy });
        } else {
          sub.guestId = null;
          subUpdates.push({ _id: sub._id, guestId: null });
          cleanedUp++;
        }
      }
    }

    // 7. Speichern (updateOne statt save() — vermeidet Mongoose-Vollvalidierung bei importierten Buchungen)
    booking.bookerSleepsAtHotel = bookerSleepsAtHotel;
    await Booking.updateOne({ _id: booking._id }, { $set: { bookerSleepsAtHotel: booking.bookerSleepsAtHotel } });
    for (const upd of subUpdates) {
      await Booking.updateOne({ _id: upd._id }, { $set: { guestId: upd.guestId } });
    }

    // 8. Response
    return res.status(200).json({
      bookerSleepsAtHotel: booking.bookerSleepsAtHotel,
      ownSubBookingCode: ownSubBookingCode ?? null,
      cleanedUp,
    });
  } catch (err) {
    console.error('[Portal sleeps-at-hotel]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/portal/:masterToken/master/send-bulk — Einladungs-Email an alle Sub-Gäste senden
router.post('/:masterToken/master/send-bulk', async (req, res) => {
  try {
    const { masterToken } = req.params;
    const { channel } = req.body;

    // 1. Master-Buchung per Token laden
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: masterToken });
    if (!booking) return res.status(404).json({ error: 'not_found' });

    // 2. Master-Check (isBeds24Master)
    const isBeds24Master = booking.beds24MasterId == null
                        && booking.beds24BookingId != null
                        && (await Booking.exists({
                             tenantId: TENANT_ID,
                             beds24MasterId: booking.beds24BookingId,
                           }));
    if (!isBeds24Master) return res.status(403).json({ error: 'not_master' });

    // 4. Nur 'email' unterstützt
    if (channel !== 'email') {
      return res.status(400).json({ error: 'unsupported_channel', supported: ['email'] });
    }

    // 3. Alle Sub-Buchungen laden
    const subs = await Booking.find({ beds24MasterId: booking.beds24BookingId, tenantId: TENANT_ID }).lean();

    const Guest = require('../models/Guest');
    const { sendInvite } = require('../services/subPortalInviteEmailService');

    // Master-Gast laden für bookerName
    const masterGuestId = booking.guestId || booking.bookedBy;
    const masterGuest = masterGuestId
      ? await Guest.findOne({ _id: masterGuestId, tenantId: TENANT_ID }, 'firstName').lean()
      : null;
    const bookerName = masterGuest?.firstName || 'Dein Gastgeber';

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const details = [];

    // 5. Pro Sub filtern + sequenziell versenden (try/catch pro Sub)
    for (const sub of subs) {
      const subBookingCode = sub.bookingNumber;

      // Owner-Room überspringen — Master-Gast braucht keine Einladung zu seinem eigenen Sub-Portal
      const isOwnerRoom = sub.guestId && sub.guestId.toString() === booking.bookedBy.toString();
      if (isOwnerRoom) {
        skipped++;
        details.push({ subBookingCode, status: 'skipped', reason: 'owner_room' });
        continue;
      }

      // Überspringen: bereits gesendet
      if (sub.lastInviteSentAt != null) {
        skipped++;
        details.push({ subBookingCode, status: 'skipped', reason: 'already_sent' });
        continue;
      }

      // Überspringen: kein guestId
      if (!sub.guestId) {
        skipped++;
        details.push({ subBookingCode, status: 'skipped', reason: 'no_email' });
        continue;
      }

      // Sub-Guest laden für Email
      let subGuest;
      try {
        subGuest = await Guest.findById(sub.guestId).lean();
      } catch (e) {
        failed++;
        console.error(`[send-bulk] Guest.findById fehlgeschlagen für sub ${subBookingCode}:`, e.message);
        details.push({ subBookingCode, status: 'failed', reason: 'error' });
        continue;
      }

      // Überspringen: kein Email auf Sub-Guest
      if (!subGuest?.email) {
        skipped++;
        details.push({ subBookingCode, status: 'skipped', reason: 'no_email' });
        continue;
      }

      // Überspringen: kein guestPortalToken
      if (!sub.guestPortalToken) {
        skipped++;
        details.push({ subBookingCode, status: 'skipped', reason: 'no_portal_token' });
        continue;
      }

      // 6. Versenden
      try {
        await sendInvite({
          toEmail: subGuest.email,
          language: subGuest.preferredLanguage || 'de',
          subPortalToken: sub.guestPortalToken,
          bookerName,
          tenantId: TENANT_ID,
        });

        await Booking.updateOne(
          { _id: sub._id, tenantId: TENANT_ID },
          { $set: { lastInviteSentAt: new Date(), lastInviteVia: 'email' } }
        );

        sent++;
        details.push({ subBookingCode, status: 'sent' });
      } catch (e) {
        failed++;
        console.error(`[send-bulk] Versand fehlgeschlagen für sub ${subBookingCode}:`, e.message);
        details.push({ subBookingCode, status: 'failed', reason: 'error' });
      }
    }

    return res.json({ success: true, sent, skipped, failed, details });
  } catch (err) {
    console.error('[Portal send-bulk]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/portal/:masterToken/master/sub/:subBookingCode/whatsapp-confirmed — WhatsApp-Bestätigung setzen
router.post('/:masterToken/master/sub/:subBookingCode/whatsapp-confirmed', async (req, res) => {
  try {
    const { masterToken, subBookingCode } = req.params;

    // 1. Master-Buchung per Token laden
    const booking = await Booking.findOne({ tenantId: TENANT_ID, guestPortalToken: masterToken });
    if (!booking) return res.status(404).json({ error: 'not_found' });

    // 2. Master-Check (isBeds24Master)
    const isBeds24Master = booking.beds24MasterId == null
                        && booking.beds24BookingId != null
                        && (await Booking.exists({
                             tenantId: TENANT_ID,
                             beds24MasterId: booking.beds24BookingId,
                           }));
    if (!isBeds24Master) return res.status(403).json({ error: 'not_master' });

    // 3. Sub-Buchung finden
    const sub = await Booking.findOne({
      bookingNumber: subBookingCode,
      beds24MasterId: booking.beds24BookingId,
      tenantId: TENANT_ID,
    });

    // 4. Sub nicht gefunden → 404
    if (!sub) return res.status(404).json({ error: 'sub_not_found' });

    // 5. lastInviteVia auf 'whatsapp_confirmed' setzen
    await Booking.updateOne(
      { _id: sub._id, tenantId: TENANT_ID },
      { $set: { lastInviteVia: 'whatsapp_confirmed' } }
    );

    // 6. Response
    return res.json({ success: true });
  } catch (err) {
    console.error('[Portal whatsapp-confirmed]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
