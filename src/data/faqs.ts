import { company } from './company';

export interface Faq {
  q: string;
  a: string;
}

/** Every answer paraphrases statements from ccoverath.de – no new claims. */
export const faqs: Faq[] = [
  {
    q: 'Welche Marken führt das Campingcenter Overath?',
    a: 'Wir sind Vertragspartner von CHALLENGER, LA STRADA und EURA MOBIL. Außerdem findest du bei uns gebrauchte Wohnmobile verschiedener Hersteller – vom Kastenwagen bis zum Alkoven.',
  },
  {
    q: 'Kann ich mein Wohnmobil an euch verkaufen?',
    a: 'Ja. Wir kaufen Wohnmobile, Wohnwagen, Vans und Boote an. Über unser Online-Formular erhältst du innerhalb von 24 Stunden ein unverbindliches Angebot. Auf Wunsch holen wir das Fahrzeug deutschlandweit ab und übernehmen die Abmeldung.',
  },
  {
    q: 'Nehmt ihr mein altes Wohnmobil in Zahlung?',
    a: 'Ja, wir nehmen dein altes Wohnmobil in Zahlung und bieten flexible Finanzierungsmöglichkeiten. Sprich uns einfach bei der Beratung darauf an.',
  },
  {
    q: 'Wie kann ich ein Wohnmobil mieten?',
    a: 'Wir sind Mietstation der ADAC Wohnmobilvermietung in Köln-Ost. Du kannst bei uns vor Ort mieten oder rund um die Uhr online über den ADAC buchen. ADAC-Mitglieder erhalten 3 % Rabatt.',
  },
  {
    q: 'Welche Prüfungen übernimmt eure Werkstatt?',
    a: 'Unter anderem TÜV-Abnahmen, Gasprüfungen, Dichtigkeitsprüfungen, Inspektionen und Bremseneinstellungen. Spezialisiert sind wir außerdem auf Nässe- und GFK-Schäden.',
  },
  {
    q: 'Kümmert ihr euch auch um Wohnwagen?',
    a: 'Ja. Wir reparieren Wohnwagen, montieren Rangiersysteme wie Reich Mover oder Truma-Mover und übernehmen Arbeiten an der Bremsen-Auflaufeinheit.',
  },
  {
    q: 'Kann ich online einen festen Werkstatttermin buchen?',
    a: `Über das Formular stellst du eine Terminanfrage mit deinem Wunschzeitraum. Wir melden uns dann bei dir und stimmen den Termin ab. Schneller geht es telefonisch unter ${company.phone.display}.`,
  },
  {
    q: 'Wann und wo finde ich euch?',
    a: 'Du findest uns in der Weberstraße 12 in 51491 Overath. Geöffnet ist Montag bis Freitag von 07:00 bis 13:00 und 14:00 bis 17:00 Uhr. Samstags ist geschlossen.',
  },
];
