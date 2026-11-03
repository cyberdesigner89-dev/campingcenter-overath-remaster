/**
 * Single source of truth for verified company facts.
 * Source: https://ccoverath.de/ (Impressum, Kontakt, Footer), audited 2026-09-30.
 */

export const company = {
  name: 'Campingcenter Overath',
  legalName: 'Campingcenter Overath GmbH & Co KG',
  claim: 'Wir pflegen die Kultur des Campings',
  motto: 'Von Campern für Camper',
  foundedStatement: 'Seit 30 Jahren',
  description:
    'Wohnmobile kaufen, mieten und professionell betreuen lassen: Vertragspartner von CHALLENGER, LA STRADA und EURA MOBIL, ADAC-Mietstation Köln-Ost und Fachwerkstatt für Wohnmobile und Wohnwagen in Overath.',
  emails: {
    service: 'service@ccoverath.de',
    rental: 'vermietung@ccoverath.de',
    finderReport: 'martin_meinke@ccoverath.de',
  },
  address: {
    street: 'Weberstraße 12',
    postalCode: '51491',
    city: 'Overath',
    region: 'Nordrhein-Westfalen',
    country: 'DE',
  },
  phone: { display: '02206 95131-0', href: 'tel:+492206951310', e164: '+492206951310' },
  fax: { display: '02206 95131-10' },
  email: 'service@ccoverath.de',
  management: ['Martin Meinke', 'Elisabeth Meinke-Markovic'],
  register: { court: 'Amtsgericht Köln', number: 'HRA 28416' },
  vatId: 'DE276083027',
  officialWebsite: 'https://ccoverath.de/',
  social: {
    facebook: 'https://www.facebook.com/ccoverath/',
  },
  inventoryPortal: 'https://home.mobile.de/CAMPINGCENTEROVERATHGMBHCOKG',
  mapsSearch:
    'https://www.google.com/maps/search/?api=1&query=Campingcenter+Overath%2C+Weberstra%C3%9Fe+12%2C+51491+Overath',
  directions:
    'https://www.google.com/maps/dir/?api=1&destination=Campingcenter+Overath%2C+Weberstra%C3%9Fe+12%2C+51491+Overath',
  mapsEmbed:
    'https://www.google.com/maps?q=Campingcenter+Overath,+Weberstra%C3%9Fe+12,+51491+Overath&output=embed',
} as const;

export interface OpeningPeriod {
  days: string;
  shortDays: string;
  schemaDays: string[];
  hours: { opens: string; closes: string }[];
}

export const openingHours: OpeningPeriod[] = [
  {
    days: 'Montag bis Freitag',
    shortDays: 'Mo–Fr',
    schemaDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    hours: [
      { opens: '07:00', closes: '13:00' },
      { opens: '14:00', closes: '17:00' },
    ],
  },
  {
    days: 'Samstag',
    shortDays: 'Sa',
    schemaDays: ['Saturday'],
    hours: [],
  },
];

export const formatHours = (p: OpeningPeriod): string =>
  p.hours.length ? p.hours.map((h) => `${h.opens}–${h.closes}`).join(' und ') + ' Uhr' : 'geschlossen';

export const directionsText = [
  {
    from: 'Von der Autobahn A4',
    steps: [
      'Ausfahrt Overath, auf der B55 nach Overath.',
      'Im Ort an der Ampel links abbiegen, unter der Bahn durch und im Kreisverkehr die 1. Ausfahrt nehmen.',
      'Der Straße bis zum Ende folgen – dort findest du uns.',
    ],
  },
  {
    from: 'Aus Richtung Lohmar',
    steps: [
      'Bis nach Overath fahren.',
      'Im Ort an der Ampel rechts und gleich wieder rechts halten.',
      'An der nächsten Ampel rechts abbiegen.',
      'Unter der Bahn durch und im Kreisverkehr die 1. Ausfahrt nehmen.',
      'Der Straße bis zum Ende folgen – dort findest du uns.',
    ],
  },
];
