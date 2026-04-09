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
