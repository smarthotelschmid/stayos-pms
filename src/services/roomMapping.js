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
    stayosRooms: ['4','5','6'],
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
    stayosRooms: ['11'],
    description: 'Einzelzimmer / Studio'
  }
};

// roomId + unitId → spezifisches STAYOS Zimmernummer
const UNIT_TO_ROOM = {
  '540305-1': 'Suite 2',
  '546886-1': 'Suite 1',
  '546887-1': 'Zimmer 4',
  '546887-2': 'Zimmer 5',
  '546887-3': 'Zimmer 6',
  '546888-1': 'Zimmer 1',
  '546888-2': 'Zimmer 2',
  '546888-3': 'Zimmer 3',
  '546888-4': 'Zimmer 7',
  '546888-5': 'Zimmer 9',
  '546889-1': 'Zimmer 10',
  '559473-1': 'Zimmer 11',
};

function getExactRoom(roomId, unitId) {
  return UNIT_TO_ROOM[`${roomId}-${unitId}`] || null;
}

module.exports = { BEDS24_ROOM_MAPPING, UNIT_TO_ROOM, getExactRoom };
