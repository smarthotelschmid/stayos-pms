async function createSubdomain(slug) {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    console.log('[Vercel] VERCEL_TOKEN oder VERCEL_PROJECT_ID nicht konfiguriert');
    return { error: 'Vercel nicht konfiguriert' };
  }
  try {
    // Domain zum Projekt hinzufügen
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${slug}.stayos.at` }),
    });
    const data = await res.json();
    console.log(`[Vercel] Subdomain ${slug}.stayos.at:`, data.error?.message || 'OK');
    return data;
  } catch (err) {
    console.error('[Vercel] Fehler:', err.message);
    return { error: err.message };
  }
}

module.exports = { createSubdomain };
