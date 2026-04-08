function checkReadiness(booking, guest) {
  const checks = {
    realName:     { label: 'Echter Name', ok: !!guest?.firstName && guest.firstName !== 'Guest' },
    nationality:  { label: 'Nationalität', ok: !!guest?.nationality || !!guest?.country || !!guest?.address?.country },
    realEmail:    { label: 'Echte Email', ok: !!guest?.email && !guest.email.includes('guest.booking.com') && !guest.emailIsFake },
    phone:        { label: 'Telefon', ok: !!guest?.phone },
    doorCode:     { label: 'Türcode', ok: !!booking?.doorAccess?.stayosCode },
    persons:      { label: 'Anzahl Gäste', ok: !!(booking?.adults) },
    price:        { label: 'Preis', ok: !!(booking?.pricing?.total) },
    mealPlan:     { label: 'Verpflegung', ok: !!booking?.mealPlan },
    guestAddress: { label: 'Gast-Adresse', ok: !!guest?.address?.street && !!guest?.address?.city },
  };

  const total = Object.keys(checks).length;
  const passed = Object.values(checks).filter(c => c.ok).length;
  const missing = Object.entries(checks).filter(([, c]) => !c.ok).map(([k, c]) => ({ key: k, label: c.label }));

  return { checks, total, passed, pct: Math.round((passed / total) * 100), missing };
}

module.exports = { checkReadiness };
