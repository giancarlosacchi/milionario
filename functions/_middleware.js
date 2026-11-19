// Cloudflare Pages middleware: protegge TUTTO il sito (pagina e /api) con una password.
//
// Variabili d'ambiente (Cloudflare Pages → Settings → Variables and Secrets, ambiente Produzione):
//   SITE_PASSWORD   (Secret) la password da dare a chi può entrare. Cambiarla butta fuori tutti.
//   GOOGLE_SA_PRIVATE_KEY entra anche nella chiave che firma i cookie di sessione (vedi sessionKey).
//
// Senza SITE_PASSWORD il sito non serve nulla (es. deploy di anteprima senza Secret).

const COOKIE = '__Host-mil_session'; // __Host-: il browser impone Secure, Path=/ e nessun Domain
const SESSION_DAYS = 14;
const MAX_FAILS = 10;               // tentativi sbagliati per IP ogni 10 minuti (contatore per isolate, indicativo)
const fails = new Map();             // ip -> { n, until }

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; " +
  "connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'";

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (!env.SITE_PASSWORD || !env.GOOGLE_SA_PRIVATE_KEY) {
    return new Response('Sito non configurato', { status: 503, headers: noStore('text/plain; charset=utf-8') });
  }

  if (url.pathname === '/login') {
    if (request.method === 'POST') return handleLogin(request, env);
    if (await validSession(request, env)) return new Response(null, { status: 303, headers: { Location: '/', 'Cache-Control': 'no-store' } });
    return loginPage(false);
  }
  if (url.pathname === '/logout' && request.method === 'POST' && sameOrigin(request)) {
    return new Response(null, {
      status: 303,
      headers: { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
    });
  }

  if (await validSession(request, env)) {
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'private, no-store');
    out.headers.set('X-Frame-Options', 'DENY');
    out.headers.set('Referrer-Policy', 'same-origin');
    out.headers.set('X-Content-Type-Options', 'nosniff');
    if ((out.headers.get('Content-Type') || '').includes('text/html')) out.headers.set('Content-Security-Policy', CSP);
    return out;
  }

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Non autorizzato' }), { status: 401, headers: noStore('application/json; charset=utf-8') });
  }
  return new Response(null, { status: 303, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
}

async function handleLogin(request, env) {
  if (!sameOrigin(request)) return new Response('Origine non valida', { status: 403 });

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const f = fails.get(ip);
  if (f && f.until > now && f.n >= MAX_FAILS) {
    return new Response('Troppi tentativi: riprova tra qualche minuto', { status: 429, headers: noStore('text/plain; charset=utf-8') });
  }

  let password = '';
  try {
    const form = await request.formData();
    password = String(form.get('password') || '');
  } catch { /* form non valido → password vuota */ }

  if (!(await samePassword(password, env.SITE_PASSWORD))) {
    const cur = f && f.until > now ? f : { n: 0, until: now + 10 * 60 * 1000 };
    cur.n++;
    fails.set(ip, cur);
    if (fails.size > 5000) fails.clear();
    await new Promise(r => setTimeout(r, 800)); // rallenta i tentativi a raffica
    return loginPage(true);
  }

  fails.delete(ip);
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const sig = await hmac(await sessionKey(env), `v1.${exp}`);
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Set-Cookie': `${COOKIE}=v1.${exp}.${sig}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    },
  });
}

async function validSession(request, env) {
  const raw = (request.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const parts = raw.slice(COOKIE.length + 1).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1])) return false;
  if (+parts[1] < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(await sessionKey(env), `v1.${parts[1]}`);
  return timingSafeEqual(parts[2], expected);
}

// La chiave di firma dipende dalla password: cambiando SITE_PASSWORD tutte le sessioni decadono.
async function sessionKey(env) {
  const material = new TextEncoder().encode(`milionario-session|${env.SITE_PASSWORD}|${env.GOOGLE_SA_PRIVATE_KEY}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function samePassword(given, expected) {
  // confronto su hash di lunghezza fissa, in tempo costante
  const h = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(await h(given), await h(expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// stessa origine: Origin uguale, oppure (browser senza Origin) Sec-Fetch-Site same-origin/none
function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  // Origin 'null' (es. pagine con Referrer-Policy restrittiva): si decide con Sec-Fetch-Site
  if (origin && origin !== 'null') return origin === new URL(request.url).origin;
  const site = request.headers.get('Sec-Fetch-Site');
  return !site || site === 'same-origin' || site === 'none';
}

function noStore(type) {
  return { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
}

function loginPage(wrong) {
  const html = `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Milionario — accesso</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b14;color:#e2e8f0;
       font-family:Inter,'Segoe UI',Arial,sans-serif;padding:16px}
  form{width:100%;max-width:340px;background:#101828;border:1px solid rgba(148,163,184,.15);border-radius:16px;padding:28px}
  h1{margin:0 0 6px;font-size:1.25rem;color:#f0b429}
  p{margin:0 0 20px;color:#8a9bb8;font-size:.9rem}
  input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(148,163,184,.25);background:#0b1220;
        color:#e2e8f0;font-size:1rem}
  input:focus{outline:2px solid #4f8ff7;outline-offset:1px}
  button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:10px;background:#4f8ff7;color:#fff;
         font-weight:700;font-size:1rem;cursor:pointer}
  .err{color:#f87171;font-size:.85rem;margin:10px 0 0}
</style></head>
<body><form method="POST" action="/login">
  <h1>Milionario</h1><p>Accesso riservato</p>
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
  ${wrong ? '<div class="err">Password errata</div>' : ''}
  <button type="submit">Entra</button>
</form></body></html>`;
  return new Response(html, {
    status: wrong ? 401 : 200,
    headers: { ...noStore('text/html; charset=utf-8'), 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" },
  });
}
