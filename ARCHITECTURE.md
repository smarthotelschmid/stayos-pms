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
