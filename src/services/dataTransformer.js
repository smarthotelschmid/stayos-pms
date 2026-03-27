const FAKE_EMAIL_PATTERNS = [
  '@guest.booking.com', '@m.airbnb.com',
  '@airbnb.com', '@guest.expedia.com'
];

function mapChannel(apiSource, channel) {
  const s = (apiSource || channel || '').toLowerCase();
  if (s.includes('booking')) return 'Booking.com';
  if (s.includes('airbnb')) return 'Airbnb';
  if (s.includes('expedia')) return 'Expedia';
  return 'Direct';
}

function mapStatus(status) {
  const s = (status || '').toLowerCase();
  if (s === 'confirmed') return 'confirmed';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'new') return 'new';
  if (s === 'checked_in') return 'checked-in';
  if (s === 'checked_out') return 'checked-out';
  return 'new';
}

function mapMealPlan(rateDescription) {
  const r = (rateDescription || '').toLowerCase();
  if (r.includes('frühstück') || r.includes('breakfast') || r.includes('bb')) return 'BB';
  if (r.includes('halbpension') || r.includes('half board') || r.includes('hb')) return 'HB';
  if (r.includes('vollpension') || r.includes('full board') || r.includes('fb')) return 'FB';
  return 'RO';
}

function isEmailFake(email) {
  if (!email) return false;
  return FAKE_EMAIL_PATTERNS.some(p => email.toLowerCase().includes(p));
}

function transformBeds24Booking(b, roomMapping) {
  const mapped = roomMapping[String(b.roomId)];
  return {
    beds24BookingId: b.id,
    beds24RoomId: b.roomId,
    beds24PropertyId: b.propertyId,
    otaBookingId: b.apiReference || null,
    referer: b.referer || null,
    bookingNumber: `B24-${b.id}`,
    guestName: [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || b.lastName || '',
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
    roomName: mapped?.name || 'Unbekannt',
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
    mealPlan: mapMealPlan(b.rateDescription),
    country2: b.country2 || b.country || null,
    guestNotes: [b.comments, b.notes, b.message].filter(Boolean).join(' | ') || null,
    externalId: String(b.id),
    tenantId: '507f1f77bcf86cd799439011'
  };
}

function transformBeds24Guest(b) {
  const email = b.email || null;
  return {
    tenantId: '507f1f77bcf86cd799439011',
    firstName: b.firstName || '',
    lastName: b.lastName || '',
    guestTitle: b.title || null,
    email: email,
    emailIsFake: isEmailFake(email),
    phone: b.phone || b.mobile || null,
    country: b.country2 || b.country || null,
    preferredLanguage: b.lang || 'de',
    language: b.lang || 'de',
    businessGuest: !!b.company,
    companyName: b.company || null,
    address: {
      street: b.address || null,
      city: b.city || null,
      state: b.state || null,
      zip: b.postcode || null,
      country: b.country2 || b.country || null
    },
    arrivalTime: b.arrivalTime || null,
    mealPlan: mapMealPlan(b.rateDescription),
    source: 'beds24',
    beds24GuestId: `beds24-${b.id}`
  };
}

module.exports = {
  transformBeds24Booking,
  transformBeds24Guest,
  mapChannel,
  mapStatus,
  mapMealPlan,
  isEmailFake
};
