const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');

const h1 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } });
const h2 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 } });
const h3 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } });
const b = (t, level = 0) => new Paragraph({ text: t, bullet: { level } });
const p = (t) => new Paragraph({ text: t, spacing: { after: 80 } });
const pb = (t) => new Paragraph({ children: [new TextRun({ text: t, bold: true })], spacing: { after: 80 } });
const gap = () => new Paragraph({ text: '' });

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ children: [new TextRun({ text: 'STAYOS Uebergabeprotokoll Session 7', bold: true, size: 48 })], alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
      new Paragraph({ children: [new TextRun({ text: 'Datum: 28. Maerz 2026', color: '666666', size: 24 })], alignment: AlignmentType.CENTER, spacing: { after: 400 } }),

      h1('1. Live URLs & Infrastruktur'),
      b('Dashboard: https://stayos-dashboard.vercel.app'),
      b('API: https://stayos-api-production.up.railway.app'),
      b('GitHub Dashboard: github.com/smarthotelschmid/stayos-dashboard'),
      b('GitHub API: github.com/smarthotelschmid/stayos-pms'),
      b('MongoDB Atlas: Frankfurt EU - M0'),
      b('Auth: Clerk - Development Keys'),
      b('Beds24: Langzeit-Token in beds24-credentials.json'),
      b('UptimeRobot: Railway Ping alle 5 Min - 100% Uptime'),

      h1('2. Was heute gebaut wurde'),

      h2('Beds24 Channel Manager (Phase 4)'),
      b('beds24Service.js: Auth + Token Auto-Refresh'),
      b('syncService.js: Auto-Sync alle 30 Min + Start-Sync'),
      b('roomMapping.js: Beds24 RoomID -> STAYOS Zimmer'),
      b('dataTransformer.js: zentrales Mapping Beds24 -> STAYOS'),
      b('120 echte Buchungen synchronisiert'),
      b('Webhook Receiver bereit'),

      h2('Beds24 Room Mapping'),
      b('540305 -> Suite 2 (APR, max 2, Badewanne)'),
      b('546886 -> Suite 1 (APL, max 5, 3 Schlafzimmer)'),
      b('546887 -> Zimmer 4,5,6 (Studio Queensize)'),
      b('546888 -> Zimmer 1,2,3,7,9 (Deluxe)'),
      b('546889 -> Zimmer 10 (Deluxe Balkon)'),
      b('559473 -> Zimmer 11 (Studio Single)'),

      h2('Kalender Verbesserungen'),
      b('Beds24 Buchungen korrekt zugewiesen'),
      b('50% Offset Check-in/Check-out'),
      b('Abgerundete Ecken'),
      b('Farben: Booking.com dunkelblau, Direct orange'),
      b('Nachname im Block'),
      b('Kompakte Zeilen 28px'),
      b('Monatsnavigation 18 Monate'),
      b('Heute-Button links, Pfeile rechts'),
      b('Monatsuebergang 5px Accent-Linie'),
      b('Tooltip: Name, Land, Zimmercode, Check-in, Verpflegung'),
      b('Dark Mode GitHub Style'),
      b('Mobile optimiert: sync scroll, responsive'),

      h2('theme.js - Zentrales CI File'),
      b('Single Source of Truth alle Farben'),
      b('Light + Dark Mode'),
      b('success, danger, gold Farben'),
      b('Vorbereitet fuer White-Label SaaS'),

      h2('Phase 5 - Gastprofil'),
      b('Guest Model vollstaendig (Meldezettel, DSGVO, Business)'),
      b('77 Gaeste aus Beds24 importiert'),
      b('emailIsFake Detection automatisch'),
      b('Company Collection (corporate + travel_agency)'),
      b('Buchungsnummer Format: SCH-XXXXXX'),
      b('otaBookingId: Booking.com Nummer parallel gespeichert'),
      b('Companions Feld im Booking Schema'),

      h2('Globale Suche'),
      b('Header Spotlight-Style (Strg+K / Cmd+K)'),
      b('Sucht: Gaeste + Buchungen + SCH-Code + OTA Nummer'),
      b('Max 15 Ergebnisse, debounced 250ms'),

      h2('Gastprofil Modal'),
      b('3 Tabs: Profil / Buchungen / Dokumente'),
      b('Vollstaendig editierbar mit Save-Feedback'),
      b('Firmenkunden mit Company Autocomplete'),
      b('Segment: Standard/VIP/Stammgast/Problemgast/Einmalig'),
      b('Besonderheiten Chips: Allergiker/Haustier/Spaete Anreise/etc.'),
      b('CountrySelect mit Flag + Suche (40 Laender)'),
      b('Oesterreichs Nachbarlaender priorisiert'),
      b('Email Validierung onBlur'),
      b('Modal schliesst nicht durch Klick ausserhalb'),
      b('Confirm Dialog bei ungespeicherten Aenderungen'),
      b('Alle Buttons aus theme.js - STAYOS CI'),

      h2('Infrastruktur'),
      b('UptimeRobot aktiv (Railway schlaeft nie)'),
      b('Buchungsnummer Migration: alle 122 auf SCH-XXXXXX'),
      b('HTML Entities dekodiert (Domi &amp; Steffi -> Domi & Steffi)'),
      b('Gast-Duplikate bereinigt (name-basierte IDs)'),

      h1('3. Architektur-Entscheidungen'),

      h2('Channel Manager Strategie'),
      b('Booking.com API eingefroren -> kein Warten'),
      b('Beds24 als Bruecke: zertifizierter Premier Partner'),
      b('STAYOS -> Beds24 API V2 -> Booking.com + Airbnb'),
      b('Adapter-Pattern: Beds24 austauschbar'),

      h2('dataTransformer.js Philosophie'),
      b('Beds24 -> STAYOS Format zentral'),
      b('Vorbereitet fuer Channex + Booking.com direkt'),
      b('generateBookingNumber(): SCH-XXXXXX'),
      b('decodeHtml(): HTML Entities bereinigen'),
      b('isEmailFake(): OTA Proxy-Emails erkennen'),

      h2('Company Collection'),
      b('Firmenkunden + Reisebueros gleiche Logik'),
      b('type: corporate / travel_agency / event'),
      b('paymentTerms: default 14 Tage'),
      b('seasonal: Saisonbetrieb-Flag'),

      h2('Buchungsnummer'),
      b('Format: SCH-XXXXXX (6 alphanumerisch)'),
      b('Keine verwechslungsfaehigen Zeichen (0,O,I,1,L)'),
      b('otaBookingId parallel gespeichert'),
      b('$setOnInsert: Nummer wird nie ueberschrieben'),

      h2('Mitreisende'),
      b('companions: [{ guestId, role, age }] im Booking'),
      b('role: companion / child / infant'),
      b('age: relevant fuer Kurtaxe (Kinder unter 14 befreit)'),

      h1('4. Offene Punkte'),

      h2('Sofort naechste Session'),
      b('Beds24 Webhook (Sofort-Sync bei neuer Buchung)'),
      b('Buchungsdetail Modal (Klick auf Buchung im Kalender)'),
      b('Neue Buchung aus Gastprofil testen'),
      b('Dark Mode vollstaendig testen'),

      h2('Kalender noch offen'),
      b('Buchung anklicken -> Buchungsdetail'),
      b('Drag & Drop (Buchung verschieben)'),

      h2('Phase 5 noch offen'),
      b('Check-in Flow'),
      b('Billing Daten'),
      b('Meldezettel digital'),

      h1('5. Projektfortschritt'),
      gap(),
      p('Phase 1: Grundgeruest                  100%'),
      p('Phase 2: Buchungssystem               100%'),
      p('Phase 3A: Dashboard V1                100%'),
      p('Phase 3B: Auth & UX                   100%'),
      p('Phase 4: Channel Manager              100%'),
      p('Phase 5: Gaestemodul                   60%'),
      p('Phase 6-15:                             0%'),
      gap(),
      pb('GESAMT: ~55%'),

      h1('6. Technische Details'),

      h2('Neue Dateien Backend'),
      b('src/services/beds24Service.js'),
      b('src/services/syncService.js'),
      b('src/services/roomMapping.js'),
      b('src/services/dataTransformer.js'),
      b('src/models/Company.js'),
      b('src/routes/beds24.js'),
      b('src/routes/companies.js'),

      h2('Neue Dateien Frontend'),
      b('app/theme.js'),
      b('app/components/GlobalSearch.jsx'),
      b('app/components/Guests.jsx'),
      b('app/components/CountrySelect.jsx'),
      b('app/data/countries.js'),

      h2('Geaenderte Dateien Backend'),
      b('src/index.js (beds24 + companies + sync)'),
      b('src/models/Booking.js (companions, companyId, invoiceRecipient)'),
      b('src/models/Guest.js (segment, specialNeeds, companyId)'),
      b('src/routes/guests.js (search + dedup aggregation)'),
      b('src/routes/bookings.js (search endpoint)'),
      b('.gitignore (beds24-credentials.json)'),

      h2('Geaenderte Dateien Frontend'),
      b('app/components/Calendar.jsx (komplett ueberarbeitet)'),
      b('app/components/Bookings.jsx (Dark Mode)'),
      b('app/components/Rooms.jsx (Dark Mode)'),
      b('app/components/Housekeeping.jsx (Dark Mode)'),
      b('app/page.js (GlobalSearch, Clerk Redirect, Dark Mode)'),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('STAYOS_Uebergabe_Session7.docx', buffer);
  console.log('STAYOS_Uebergabe_Session7.docx erstellt (' + Math.round(buffer.length/1024) + ' KB)');
});
