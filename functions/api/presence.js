// Cloudflare Pages Function: GET /api/presence (WebSocket)
// Collega il browser al servizio "chi c'è sul sito" (Worker milionario-presenza, cartella presenza/).
// Serve il collegamento PRESENCE nelle impostazioni del progetto Pages (vedi SETUP-ACCESSO.md);
// se manca, il sito funziona lo stesso, solo senza i puntatori degli altri.
//
// L'accesso è già controllato da functions/_middleware.js (password): qui arrivano solo utenti entrati.

export async function onRequestGet({ request, env }) {
  const plain = (text, status) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!env.PRESENCE) return plain('Presenza non configurata', 503);
  if (request.headers.get('Upgrade') !== 'websocket') return plain('Serve una connessione WebSocket', 426);
  // un WebSocket porta con sé il cookie anche se aperto da un altro sito: si accetta solo la stessa origine
  if (request.headers.get('Origin') !== new URL(request.url).origin) return plain('Origine non valida', 403);
  const stub = env.PRESENCE.get(env.PRESENCE.idFromName('sito'));
  return stub.fetch(request);
}
