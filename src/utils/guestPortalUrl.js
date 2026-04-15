// Einheitlicher Gastportal-Link-Builder.
// Priorität:
//   1. Custom Domain (verifiziert)  → https://{customDomain}/portal/{token}
//   2. Tenant-Slug                  → https://{slug}.stayos.at/portal/{token}
//   3. Leer
function buildGuestPortalUrl(token, settings) {
  if (!token) return '';
  if (settings?.customDomainVerified && settings?.customDomain) {
    return `https://${settings.customDomain}/portal/${token}`;
  }
  if (settings?.slug) {
    return `https://${settings.slug}.stayos.at/portal/${token}`;
  }
  return '';
}

module.exports = { buildGuestPortalUrl };
