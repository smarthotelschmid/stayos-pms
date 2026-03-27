const BEDS24_ROOM_MAPPING = {
  '540305': {
    name: 'Suite 2',
    type: 'suite',
    maxGuests: 2,
    hasBalcony: false,
    stayosRooms: ['APR'],
    description: 'Appartement Rechts · Badewanne'
  },
  '546886': {
    name: 'Suite 1',
    type: 'suite',
    maxGuests: 5,
    hasBalcony: false,
    stayosRooms: ['APL'],
    description: 'Appartement Links · 3 Schlafzimmer'
  },
  '546887': {
    name: 'Studio Queensize',
    type: 'double',
    maxGuests: 2,
    hasBalcony: false,
    stayosRooms: ['1','2','3','7','9'],
    description: 'Deluxe Doppelzimmer'
  },
  '546888': {
    name: 'Deluxe',
    type: 'double',
    maxGuests: 2,
    hasBalcony: false,
    stayosRooms: ['1','2','3','7','9'],
    description: 'Deluxe Doppelzimmer'
  },
  '546889': {
    name: 'Deluxe Balkon',
    type: 'double',
    maxGuests: 2,
    hasBalcony: true,
    stayosRooms: ['10'],
    description: 'Deluxe mit Balkon · Upsell'
  },
  '559473': {
    name: 'Studio Single',
    type: 'single',
    maxGuests: 1,
    hasBalcony: false,
    stayosRooms: ['4','5','6','11'],
    description: 'Einzelzimmer / Studio'
  }
};

module.exports = BEDS24_ROOM_MAPPING;
