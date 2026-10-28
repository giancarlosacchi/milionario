// Cloudflare Pages Function: GET /api/sheet
// Legge la scheda GENOA FIXTURES del Google Sheet privato tramite un account di servizio
// e restituisce la risposta gviz (stesso formato che il sito leggeva prima direttamente da Google).
//
// Variabili d'ambiente (Cloudflare Pages → Settings → Variables and Secrets, ambiente Produzione):
//   SHEET_ID              ID del Google Sheet
//   GOOGLE_SA_EMAIL       email dell'account di servizio (…@….iam.gserviceaccount.com)
//   GOOGLE_SA_PRIVATE_KEY chiave privata PEM dell'account di servizio (campo private_key del JSON)
//
// L'accesso è già controllato da functions/_middleware.js (password): qui arrivano solo utenti entrati.

// Il client non può scegliere scheda o intervallo: sono fissi qui.
const SHEET_NAME = 'GENOA FIXTURES';
const RANGE = 'A2:Z';
// L'endpoint gviz non è un'API documentata e accetta in modo affidabile solo token con scope Drive.
// Di fatto non allarga i permessi: l'account di servizio vede solo i file condivisi con lui.
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

let tokenCache = null; // { token, exp }

export async function onRequestGet({ env }) {
  for (const k of ['SHEET_ID', 'GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY']) {
    if (!env[k]) return json({ error: 'Configurazione incompleta sul server' }, 500);
  }

  try {
    const token = await getGoogleToken(env);
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(env.SHEET_ID)}/gviz/tq` +
      `?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}&range=${RANGE}`;
    // redirect manuale: se Google non accetta il token rimanda alla pagina di login (302), che non va scambiata per dati.
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
    if (r.status !== 200) { console.error('gviz status', r.status); return json({ error: 'Impossibile leggere il foglio' }, 502); }
    const text = await r.text();
    // Google risponde con "/*O_o*/\ngoogle.visualization.Query.setResponse({...});"
    const marker = 'google.visualization.Query.setResponse(';
    const start = text.indexOf(marker), end = text.lastIndexOf('}');
    if (start < 0 || end < start) return json({ error: 'Risposta inattesa da Google Sheets' }, 502);
    return new Response(text.slice(start + marker.length, end + 1), { headers: baseHeaders() });
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

// ── Google: token OAuth dall'account di servizio (JWT RS256) ────────────────────
async function getGoogleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: env.GOOGLE_SA_EMAIL,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
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

// ── base64url ───────────────────────────────────────────────────────────────────
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(new TextEncoder().encode(JSON.stringify(obj))); }
function pemToBytes(pem) {
  // La chiave incollata nei Secret può avere "\n" letterali al posto degli a capo.
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), c => c.charCodeAt(0));
}
