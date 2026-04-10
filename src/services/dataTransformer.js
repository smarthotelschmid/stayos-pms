const FAKE_EMAIL_PATTERNS = [
  '@guest.booking.com', '@m.airbnb.com',
  '@airbnb.com', '@guest.expedia.com'
];

const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateBookingNumber(tenantCode = 'SCH') {
  const code = Array.from({length: 6}, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('');
  return `${tenantCode}-${code}`;
}

function decodeHtml(str) {
  if (!str) return str;
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function mapChannel(apiSource, channel) {
  const s = (apiSource || channel || '').toLowerCase().trim();
  if (s === 'booking.com' || s.includes('booking')) return 'Booking.com';
  if (s === 'airbnb' || s.includes('airbnb')) return 'Airbnb';
  if (s === 'expedia' || s.includes('expedia')) return 'Expedia';
  if (s === 'vrbo' || s.includes('vrbo')) return 'Vrbo';
  if (s === 'agoda' || s.includes('agoda')) return 'Agoda';
  if (s === 'tripadvisor' || s.includes('tripadvisor')) return 'TripAdvisor';
  if (s === 'google' || s.includes('google')) return 'Google';
  if (s === 'direct' || s === 'direkt' || s === '') return 'Direct';
  if (apiSource) return apiSource;
  return 'Direct';
}

function mapStatus(status) {
  const s = (status || '').toLowerCase();
  if (s === 'confirmed') return 'confirmed';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'new') return 'confirmed';
  if (s === 'checked_in') return 'checked-in';
  if (s === 'checked_out') return 'checked-out';
  return 'confirmed';
}

function cleanCompanyFromGuestName(guestName, companyName) {
  if (!guestName || !companyName) return guestName;
  let cleaned = guestName;
  // Remove company name variations
  cleaned = cleaned.replace(/STM\s+Sp\.\s*z\s*o\.o\./gi, '');
  cleaned = cleaned.replace(/GmbH/gi, '');
  cleaned = cleaned.replace(/Touristik/gi, '');
  // Remove VAT IDs
  cleaned = cleaned.replace(/[A-Z]{2}\d{8,}/g, '');
  // Remove the company name itself
  if (companyName) {
    const escaped = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escaped, 'gi'), '');
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || guestName;
}

function extractDoorCode(b) {
  const infoItems = b.infoItems || b.infoCodes || [];
  const PIN_KEYS = [
    'LOCK_PIN',        // TTLock
    'NUKI_PIN',        // Nuki
    'LOCKSTATE_PIN',   // Remotelock
    'JERVIS_LOCK_PIN', // Jervis
  ];

  for (const key of PIN_KEYS) {
    const item = infoItems.find(i => i.code === key || i.name === key);
    if (item?.text || item?.value) {
      return {
        code: item.text || item.value,
        source: key,
        validFrom: b.arrival,
        validTo: b.departure,
      };
    }
  }
  return null;
}

function mapMealPlan(rateDescription, apiMessage) {
  // 1. apiMessage hat die zuverlässigste Info (direkt von Booking.com)
  const msg = (apiMessage || '').toLowerCase();
  const mealLine = msg.match(/meal plan:\s*([^\n]+)/)?.[1] || '';
  if (mealLine.includes('frühstück') || mealLine.includes('breakfast')) return 'BB';
  if (mealLine.includes('halbpension') || mealLine.includes('half board')) return 'HB';
  if (mealLine.includes('vollpension') || mealLine.includes('full board')) return 'FB';
  if (mealLine.includes('keine mahlzeit') || mealLine.includes('no meal')) return 'RO';

  // 2. Fallback auf rateDescription
  const r = (rateDescription || '').toLowerCase();
  if (r.includes('frühstück') || r.includes('breakfast') || r.includes('bb')) return 'BB';
  if (r.includes('halbpension') || r.includes('half board') || r.includes('hb')) return 'HB';
  if (r.includes('vollpension') || r.includes('full board') || r.includes('fb')) return 'FB';
  return 'RO';
}

// Adresse: Straße von Hausnummer trennen
function splitAddress(addr) {
  if (!addr) return { street: null, streetNo: null };
  const normalized = addr.replace(/([a-zA-ZäöüÄÖÜß.])(\d)/g, '$1 $2').replace(/str\./gi, 'straße').trim();
  const match = normalized.match(/^(.+?)\s+(\d+\s*[a-zA-Z]?)$/);
  if (match) return { street: match[1].trim(), streetNo: match[2].trim() };
  return { street: normalized, streetNo: null };
}

function isEmailFake(email) {
  if (!email) return false;
  return FAKE_EMAIL_PATTERNS.some(p => email.toLowerCase().includes(p));
}

function transformBeds24Booking(b, roomMapping, unitMapping) {
  const mapped = roomMapping[String(b.roomId)];
  const exactRoom = unitMapping ? unitMapping[`${b.roomId}-${b.unitId}`] : null;
  return {
    beds24BookingId: b.id,
    beds24RoomId: b.roomId,
    beds24UnitId: b.unitId || null,
    beds24PropertyId: b.propertyId,
    otaBookingId: b.apiReference || (b.apiMessage?.match(/Room R.*?Id:\s*(\d+)/)?.[1]) || null,
    referer: b.referer || null,
    bookingNumber: generateBookingNumber(),
    guestName: decodeHtml(
      [b.firstName, b.lastName].filter(Boolean).join(' ').trim()
      || (b.guests?.[0] ? [b.guests[0].firstName, b.guests[0].lastName].filter(Boolean).join(' ').trim() : '')
      || b.company
      || ''
    ),
    beds24Guests: b.guests || [],
    guestTitle: b.title || null,
    adults: b.numAdult || 1,
    children: b.numChild || 0,
    checkIn: new Date(b.arrival),
    checkOut: new Date(b.departure),
    nights: Math.round((new Date(b.departure) - new Date(b.arrival)) / 86400000),
    arrivalTime: b.arrivalTime || null,
    bookedAt: b.bookingTime ? new Date(b.bookingTime) : null,
    modifiedAt: b.modifiedTime ? new Date(b.modifiedTime) : null,
    cancelledAt: b.cancelTime ? new Date(b.cancelTime) : null,
    roomName: exactRoom || mapped?.name || 'Unbekannt',
    roomType: mapped?.type || 'unknown',
    hasBalcony: mapped?.hasBalcony || false,
    channel: mapChannel(b.apiSource, b.channel),
    source: 'beds24',
    status: mapStatus(b.status),
    pricing: {
      total: b.price || 0,
      deposit: b.deposit || 0,
      tax: b.tax || 0,
      commission: b.commission || 0,
      currency: 'EUR'
    },
    rateDescription: b.rateDescription || null,
    mealPlan: mapMealPlan(b.rateDescription, b.apiMessage),
    country2: b.country2 || b.country || null,
    doorAccess: extractDoorCode(b) || null,
    guestNotes: [b.comments, b.notes, b.message].filter(Boolean).join(' | ') || null,
    externalId: String(b.id),
    tenantId: '507f1f77bcf86cd799439011'
  };
}

function transformBeds24Guest(b) {
  const g = b.guests?.[0];
  const isCompany = !!b.company && !b.firstName && !b.lastName;

  // For company bookings: guest data comes from guest tab
  // For normal bookings: prefer booking-level name (actual booker), guests[0] may be group organizer
  const guestEmail = isCompany ? (g?.email || null) : (b.email || g?.email || null);
  const firstName = decodeHtml(isCompany ? (g?.firstName || b.firstName || '') : (b.firstName || g?.firstName || ''));
  const lastName = decodeHtml(isCompany ? (g?.lastName || b.lastName || '') : (b.lastName || g?.lastName || ''));
  const isFake = isEmailFake(guestEmail);

  const normName = `${firstName}-${lastName}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u00C0-\u024F-]/g, '');
  const guestId = guestEmail && !isFake
    ? `email-${guestEmail.toLowerCase()}`
    : `name-${normName}`;

  return {
    tenantId: '507f1f77bcf86cd799439011',
    firstName,
    lastName,
    guestTitle: b.title || g?.title || null,
    email: guestEmail,
    emailIsFake: isFake,
    phone: isCompany ? (g?.phone || g?.mobile || null) : (b.phone || b.mobile || g?.phone || g?.mobile || null),
    country: isCompany ? (g?.country2 || g?.country || null) : (b.country2 || b.country || null),
    preferredLanguage: b.lang || 'de',
    language: b.lang || 'de',
    businessGuest: isCompany,
    companyName: decodeHtml(b.company) || null,
    // Company bookings: address belongs to company, not guest
    address: isCompany ? null : (() => {
      const { street, streetNo } = splitAddress(b.address);
      return {
      street,
      streetNo,
      city: b.city || null,
      state: b.state || null,
      zip: b.postcode || null,
      country: b.country2 || b.country || null
    };})(),
    arrivalTime: b.arrivalTime || null,
    mealPlan: mapMealPlan(b.rateDescription, b.apiMessage),
    source: 'beds24',
    beds24GuestId: guestId
  };
}

function transformBeds24Company(b) {
  if (!b.company) return null;
  const name = decodeHtml(b.company).trim();
  const isTravel = name.toLowerCase().includes('touristik') || name.toLowerCase().includes('reise') || name.toLowerCase().includes('travel');
  return {
    tenantId: '507f1f77bcf86cd799439011',
    name,
    type: isTravel ? 'travel_agency' : 'corporate',
    contactEmail: b.email || null,
    address: (() => {
      const { street, streetNo } = splitAddress(b.address);
      return { street, streetNo, city: b.city || null, zip: b.postcode || null, country: b.country2 || b.country || null };
    })(),
    isActive: true,
  };
}

module.exports = {
  transformBeds24Booking,
  transformBeds24Guest,
  transformBeds24Company,
  extractDoorCode,
  cleanCompanyFromGuestName,
  generateBookingNumber,
  mapChannel,
  mapStatus,
  mapMealPlan,
  isEmailFake,
  decodeHtml
};
