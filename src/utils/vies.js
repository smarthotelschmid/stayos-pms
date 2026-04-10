async function checkVIES(countryCode, vatNumber) {
  try {
    const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.valid) return null;
    return {
      valid: true,
      name: data.traderName || null,
      address: data.traderAddress || null,
      countryCode: data.countryCode,
      vatNumber: data.vatNumber,
    };
  } catch {
    return null;
  }
}

module.exports = { checkVIES };
