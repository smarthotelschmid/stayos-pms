const cron = require('node-cron');
const { getToken, ttlockPost, CLIENT_ID, TENANT_ID } = require('./ttlockHelper');

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function timeToUnix(dateStr, timeStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const [h, min] = (timeStr || '15:00').split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h, min);
  const viennaStr = new Date(utcMs).toLocaleString('en', { timeZone: 'Europe/Vienna', timeZoneName: 'shortOffset' });
  const match = viennaStr.match(/GMT([+-]\d+)/);
  const offsetH = match ? parseInt(match[1]) : 2;
  return utcMs - offsetH * 3600000;
}

// "06:30" → cron expression "30 6 * * *"
function timeToCron(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return `${m || 0} ${h || 0} * * *`;
}

// ─── Template-Timing aus DB laden ────────────────────────────────────────────

async function getDoorcodeTemplate() {
  try {
    const EmailTemplate = require('../models/EmailTemplate');
    const tpl = await EmailTemplate.findOne(
      { tenantId: TENANT_ID, type: 'doorcode' },
      'sendTime daysBefore'
    ).lean();
    return {
      sendTime:   tpl?.sendTime || '06:00',
      daysBefore: tpl?.daysBefore !== undefined ? tpl.daysBefore : 0,
    };
  } catch {
    return { sendTime: '06:00', daysBefore: 0 };
  }
}

// ─── Zeitsynchronisierung ─────────────────────────────────────────────────────

const ALL_LOCKS = [
  3321320, 2720122, 2720112, 2521990, 2522158, 2720132, 2720138,
  2720152, 2720148, 2720144, 2720136, 2720126, 3653352, 3653284,
];

async function syncLockTime() {
  try {
    const token = await getToken();
    let ok = 0, fail = 0;
    for (const lockId of ALL_LOCKS) {
      try {
        const result = await ttlockPost('/v3/lock/updateDate', {
          clientId: CLIENT_ID, accessToken: token, lockId, date: Date.now(),
        });
        if (result.date && !result.errcode) { ok++; }
        else {
          await new Promise(r => setTimeout(r, 3000));
          const retry = await ttlockPost('/v3/lock/updateDate', {
            clientId: CLIENT_ID, accessToken: token, lockId, date: Date.now(),
          });
          if (retry.date && !retry.errcode) ok++; else fail++;
        }
      } catch { fail++; }
    }
    console.log(`[TTLock TimeSync] ${ok}/${ALL_LOCKS.length} Schlösser synchronisiert${fail ? `, ${fail} fehlgeschlagen` : ''}`);
  } catch (err) {
    console.error('[TTLock TimeSync] Fehler:', err.message);
  }
}

// ─── Cron-Start ───────────────────────────────────────────────────────────────
// Türcode-Generierung läuft nicht mehr per Cron — Codes werden sofort beim
// Sync einer neuen Buchung in syncService.js erzeugt. Hier nur noch der
// tägliche Lock-TimeSync um 03:00.

async function startTTLockCron() {
  cron.schedule('0 3 * * *', () => {
    console.log('[TTLock TimeSync] Starte Zeitsynchronisierung...');
    syncLockTime();
  }, { timezone: 'Europe/Vienna' });

  console.log('[TTLock Cron] Gestartet — TimeSync 03:00 (Code-Generierung erfolgt bei Buchungseingang)');
}

module.exports = { startTTLockCron, syncLockTime, timeToCron, getDoorcodeTemplate, timeToUnix };
