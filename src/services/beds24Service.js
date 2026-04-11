const fs = require('fs');
const path = require('path');

const CREDENTIALS_FILE = path.join(__dirname, '..', '..', 'beds24-credentials.json');
const BASE_URL = 'https://beds24.com/api/v2';
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      const reason = err.name === 'AbortError' ? 'Timeout (30s)' : err.message;
      if (attempt < retries) {
        console.log(`[Beds24 API] Versuch ${attempt}/${retries} fehlgeschlagen: ${reason} — Retry in ${attempt * 2}s`);
        await new Promise(r => setTimeout(r, attempt * 2000));
      } else {
        throw new Error(`${reason} (nach ${retries} Versuchen)`);
      }
    }
  }
}

class Beds24Service {
  _readCredentials() {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  }

  _saveCredentials(data) {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2));
  }

  async authenticate(tokenOrInviteCode) {
    // Prüfe ob es ein gültiger Token ist (Longlife Token)
    const detailsRes = await fetchWithRetry(`${BASE_URL}/authentication/details`, {
      headers: { token: tokenOrInviteCode }
    });
    const details = await detailsRes.json();

    if (details.validToken) {
      this._saveCredentials({
        token: tokenOrInviteCode,
        tokenExpiry: details.token.expiresIn ? new Date(Date.now() + details.token.expiresIn * 1000).toISOString() : null,
        scopes: details.token.scopes,
        longlife: true
      });
      return { status: 'ok', type: 'longlife-token', scopes: details.token.scopes };
    }

    // Sonst als Invite Code behandeln
    const res = await fetchWithRetry(`${BASE_URL}/authentication/setup`, {
      headers: { code: tokenOrInviteCode }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || JSON.stringify(data) || `Setup fehlgeschlagen (${res.status})`);

    this._saveCredentials({
      refreshToken: data.refreshToken,
      token: data.token,
      tokenExpiry: data.expiresAt
    });
    return data;
  }

  async getToken() {
    const creds = this._readCredentials();
    if (!creds || !creds.token) throw new Error('Keine Beds24 Credentials vorhanden. Bitte zuerst /api/beds24/auth aufrufen.');

    // Longlife Token direkt zurückgeben
    if (creds.longlife) return creds.token;

    const expiryMs = new Date(creds.tokenExpiry).getTime();
    if (expiryMs > Date.now() + 60000) return creds.token;

    const res = await fetchWithRetry(`${BASE_URL}/authentication/token`, {
      headers: { refreshToken: creds.refreshToken }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Token-Refresh fehlgeschlagen (${res.status})`);

    creds.token = data.token;
    creds.tokenExpiry = data.expiresAt;
    this._saveCredentials(creds);
    return creds.token;
  }

  async getBookings(fromDate, toDate, page) {
    const token = await this.getToken();
    const query = { arrival_from: fromDate, arrival_to: toDate, includeGuests: 'true', includeInfoItems: 'true' };
    if (page && page > 1) query.page = page;
    const params = new URLSearchParams(query);
    const res = await fetchWithRetry(`${BASE_URL}/bookings?${params}`, {
      headers: { token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Bookings-Abfrage fehlgeschlagen (${res.status})`);
    return data;
  }

  async getCalendar(roomId, fromDate, toDate) {
    const token = await this.getToken();
    const params = new URLSearchParams({ roomId, startDate: fromDate, endDate: toDate });
    const res = await fetchWithRetry(`${BASE_URL}/inventory/rooms/calendar?${params}`, {
      headers: { token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Calendar-Abfrage fehlgeschlagen (${res.status})`);
    return data;
  }

  async updateCalendar(roomId, calendarEntries) {
    const token = await this.getToken();
    const res = await fetchWithRetry(`${BASE_URL}/inventory/rooms/calendar`, {
      method: 'POST',
      headers: { token, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ roomId, calendar: calendarEntries }])
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `Calendar-Update fehlgeschlagen (${res.status})`);
    return data;
  }
}

module.exports = new Beds24Service();
