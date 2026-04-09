# STAYOS White-Label Strategie

## Portal Domain
- Default für alle Hotels: `slug.stayos.at/portal/TOKEN`
- Beispiel: `smarthotel-schmid.stayos.at/portal/TOKEN`
- Kein Custom Domain Support für Portal — nicht nötig, nicht geplant
- `portal.smarthotel-schmid.at` war Test, wird nicht weiterverfolgt

## Email
- Default: Versand über STAYOS SMTP (Wildcard `*@stayos.at`) — kommt bei SaaS Pre-Launch
- Premium: Kunde hinterlegt eigenen SMTP in Settings → sendet über `booking@meinhotel.at`
- Kein weiteres White-Label für Email geplant

## Was NICHT gebaut wird
- Custom Portal Domain (`portal.meinhotel.at`) — gestrichen
- Wildcard SMTP kommt erst bei SaaS Pre-Launch
- DNS-Automatisierung für Kunden — nicht nötig

## Tenant Identifikation
- Jeder Kunde hat einen `slug` in Settings
- Portal-Links: `https://${slug}.stayos.at/portal/${token}`
- Email-Absender Default: `booking@${slug}.stayos.at`
- Email-Absender Premium: aus `settings.smtp.user`

## Slug — wichtige Hinweise
- Slug wird beim Onboarding EINMALIG gesetzt
- Danach permanent gelockt — keine Änderung über UI möglich
- Änderung nur manuell via DB + Vercel CLI (Support-Aufwand)
- Konsequenz: alle Portal-Links in Emails brechen bei Slug-Änderung

## Onboarding UX (ToDo)
- Beim ersten Setup großer Hinweis:
  "Dieser Link wird in allen Gäste-Emails verwendet.
   Wähle deinen Slug sorgfältig — er kann später nicht geändert werden."
- Vorschau zeigen: "Deine Gäste erhalten Links wie:
  https://mein-hotel.stayos.at/portal/..."
- Bestätigung mit Checkbox bevor Slug gesetzt wird

## Multi-Property Architektur

Tenant (STAYOS Account / Login)
└── 1..n Properties (Hotels, Standorte, Appartements)
    └── 1..n Rooms

### Rechnungsstellung
- Jede Property hat eigene billingEntity
- Wenn billingEntity.companyName leer → Fallback auf Settings.companyName
- Ermöglicht: eine GmbH mehrere Properties ODER jede Property eigene GmbH

### Beispiel Schmid 1954 GmbH
- Property 1: Smarthotel Schmid, Schlossbergstraße 20
- Property 2: Suiten Schmid, Schlossbergstraße 22
- Beide: billingEntity = Schmid 1954 GmbH (vorerst)

### Kalender Multi-Property (ToDo)
- Tab-System: [Alle] [Smarthotel Schmid] [Suiten Schmid]
- Pro Property eigener Kalender oder kombinierte Ansicht

## TTLock Multi-Account
- Aktuell: ein TTLock Account für alle Schlösser (clientId in .env)
- SaaS: TTLock Credentials auf Property-Ebene (Property.ttlock)
- Für Schmid: ein Account für beide Properties → passt

## Beds24 Multi-Account
- Aktuell: ein Beds24 Account für alle Buchungen
- SaaS: Beds24 Credentials auf Property-Ebene
- Für Schmid: ein Account → passt

## Lock Provider Abstraction (ToDo)
- Property.lockProvider: 'ttlock' | 'nuki' | 'salto' | 'dormakaba' | ...
- Einheitliches Interface: generateCode(), deleteCode(), unlock()
- Implementierung: vor erstem Kunden mit anderem Anbieter
