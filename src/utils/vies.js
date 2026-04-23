async function checkVIES(countryCode, vatNumber) {
  try {
    const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.isValid) return null;
    return {
      valid: true,
      name: data.name || null,
      address: data.address || null,
      countryCode,
      vatNumber: data.vatNumber,
    };
  } catch {
    return null;
  }
}

module.exports = { checkVIES };
