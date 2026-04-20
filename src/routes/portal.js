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

const TENANT_ID = '507f1f77bcf86cd799439011';
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
    const guest = booking.guestId ? await Guest.findOne({ _id: booking.guestId, tenantId: TENANT_ID }, 'preferredLanguage email').lean() : null;
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

    // Gastname splitten
    const nameParts = (booking.guestName || '').trim().split(/\s+/);
    const guestFirstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : nameParts[0] || '';

    res.json({
      success: true,
      data: {
        bookingNumber: booking.bookingNumber,
        guestName: booking.guestName,
        guestFirstName,
        guestEmail: booking.contactEmail || (guest?.email) || null,
        guestEmailIsFake: !!(booking.contactEmail && ["@guest.booking.com","@m.airbnb.com","@airbnb.com","@guest.expedia.com"].some(p => (booking.contactEmail || "").toLowerCase().includes(p))),
        roomName: booking.roomName,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights,
        doorCode: (booking.checkInCompleted || booking.checkInForm?.completed) ? (booking.doorAccess?.stayosCode || booking.doorAccess?.code || null) : null,
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
        persons: booking.persons || 1,
        legalPrivacyUrl: settings?.legal?.privacyUrl || null,
        legalImprintUrl: settings?.legal?.imprintUrl || null,
        isTest: booking.isTest === true,
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
      await Guest.updateOne({ _id: booking.guestId }, { $set: guestUpdate });

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
        await Guest.updateOne({ _id: booking.guestId }, { $set: { companyId: company._id, companyName: company.name } });
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
    if (booking.checkInCompleted || booking.checkInForm?.completed) {
      return res.json({
        success: true,
        alreadyCompleted: true,
        doorCode: booking.doorAccess?.stayosCode || null,
      });
    }

    const { guestData, invoiceRecipient, platformConsent } = req.body;
    if (!guestData?.firstName || !guestData?.lastName || !guestData?.email) {
      return res.status(400).json({ success: false, error: 'Pflichtfelder fehlen' });
    }

    const Guest = require('../models/Guest');
    const mongoose = require('mongoose');
    const guestCol = mongoose.connection.db.collection('guests');

    // Cross-tenant lookup (Doctolib-Prinzip)
    const existingGuest = await guestCol.findOne({ email: guestData.email, status: { $ne: 'anonymized' } });
    let guestId;

    if (existingGuest) {
      // Bestehenden Gast updaten via raw collection (bypassed tenantId plugin)
      // firstName + lastName nie überschreiben bei bestehendem Profil
      const updateFields = { updatedAt: new Date() };
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
    } else {
      booking.invoiceRecipient = { type: 'private' };
    }

    // Booking abschließen
    booking.guestId = guestId;
    booking.guestName = guestData.firstName + ' ' + guestData.lastName;
    booking.checkInCompleted = true;
    booking.checkedInAt = new Date();
    booking.checkinMethod = 'portal';
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
      const crypto = require(crypto);
      const companionDocs = [];
      for (const comp of req.body.companions) {
        const dob = comp.dateOfBirth ? new Date(comp.dateOfBirth) : null;
        const checkInDate = new Date(booking.checkIn);
        const ageAtCheckin = dob ? Math.floor((checkInDate - dob) / (365.25 * 24 * 60 * 60 * 1000)) : null;
        const stgCode = crypto.randomBytes(3).toString(hex).toUpperCase();
        const companion = new Guest({
          tenantId: TENANT_ID,
          firstName: comp.firstName,
          lastName: comp.lastName,
          birthDate: dob,
          stayosGuestId: STG- + stgCode,
          primaryGuestId: guestId,
          relationship: family_member,
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

module.exports = router;
