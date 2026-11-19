// Cloudflare Pages Function: GET /api/data
// Legge dal Google Sheet privato le schede che servono alla dashboard "Fissati Genova"
// (GENOA FIXTURES, FATTURE, PBI, GENOA S&P e i nomi dei broker) con l'API ufficiale Google Sheets
// e le restituisce così come sono: i calcoli li fa la pagina.
//
// Richiede "Google Sheets API" attiva nel progetto Google Cloud dell'account di servizio (vedi SETUP-ACCESSO.md).
//
// Variabili d'ambiente (le stesse di /api/sheet):
//   SHEET_ID, GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY
//
// L'accesso è già controllato da functions/_middleware.js (password): qui arrivano solo utenti entrati.

// Il client non può scegliere schede o intervalli: sono fissi qui. RUBRICA e FERIE non vengono mai lette.
const RANGES = [
  "'GENOA FIXTURES'!A3:T",
  "'FATTURE'!A2:AM",
  "'PBI'!A1:Y",
  "'GENOA S&P'!A3:R",
  "'Foglio14'!A1:A20",
];
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const CACHE_SECONDS = 20; // più persone con la pagina aperta non moltiplicano le letture del foglio

let tokenCache = null; // { token, exp }
let dataCache = null;  // { body, at }

export async function onRequestGet({ env }) {
  for (const k of ['SHEET_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY']) {
    if (!env[k]) return json({ error: 'Configurazione incompleta sul server' }, 500);
  }
  const now = Date.now();
  if (dataCache && now - dataCache.at < CACHE_SECONDS * 1000) return new Response(dataCache.body, { headers: baseHeaders() });

  try {
    const token = await getGoogleToken(env);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values:batchGet` +
      '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS' +
      RANGES.map(r => '&ranges=' + encodeURIComponent(r)).join('');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 403) {
      console.error('sheets 403', (await r.text()).slice(0, 300));
      return json({ error: 'Google ha rifiutato la lettura (403): attiva "Google Sheets API" nel progetto Google Cloud e controlla che il foglio sia condiviso con l\'account di servizio.' }, 502);
    }
    if (r.status === 400) {
      console.error('sheets 400', (await r.text()).slice(0, 300));
      return json({ error: 'Una delle schede non è stata trovata: controlla che esistano GENOA FIXTURES, FATTURE, PBI, GENOA S&P e Foglio14.' }, 502);
    }
    if (r.status !== 200) { console.error('sheets status', r.status); return json({ error: 'Impossibile leggere il foglio' }, 502); }
    const data = await r.json();
    const body = JSON.stringify({ valueRanges: (data.valueRanges || []).map(v => ({ values: v.values || [] })) });
    dataCache = { body, at: now };
    return new Response(body, { headers: baseHeaders() });
  } catch (e) {
    return json({ error: 'Impossibile leggere il foglio' }, 502);
  }
}

function baseHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: baseHeaders() });
}

// ── Google: token OAuth dall'account di servizio (JWT RS256), come in sheet.js ──
async function getGoogleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: env.GOOGLE_SA_EMAIL, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToBytes(env.GOOGLE_SA_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const data = await r.json();
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(new TextEncoder().encode(JSON.stringify(obj))); }
function pemToBytes(pem) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), c => c.charCodeAt(0));
}
