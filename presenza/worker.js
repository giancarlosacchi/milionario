// Worker "milionario-presenza": un Durable Object che tiene aperte le connessioni di chi sta guardando il sito
// e rimanda a tutti la posizione del mouse degli altri. Non salva nulla e non vede i dati del foglio.
//
// Non ha un indirizzo pubblico (workers_dev = false): lo raggiunge solo il sito, da functions/api/presence.js,
// dopo il controllo della password. Si pubblica una volta con `npx wrangler deploy` (vedi SETUP-ACCESSO.md).

const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#e03131', '#0c8599', '#f08c00', '#6741d9', '#c2255c', '#5c940d'];
const MAX_PEERS = 40;
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Ospite';

export class Presence {
  constructor() { this.peers = new Map(); this.seq = 0; } // id -> { ws, name, color, k, x, y }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Serve una connessione WebSocket', { status: 426 });
    if (this.peers.size >= MAX_PEERS) return new Response('Troppe persone collegate', { status: 503 });

    const pair = new WebSocketPair();
    const client = pair[0], ws = pair[1];
    ws.accept();

    const id = String(++this.seq) + '-' + Math.random().toString(36).slice(2, 6);
    const used = new Set([...this.peers.values()].map(p => p.color));
    const color = COLORS.find(c => !used.has(c)) || COLORS[this.seq % COLORS.length];
    const me = { ws, name: cleanName(new URL(request.url).searchParams.get('name')), color, k: -1, x: 0, y: 0, n: 0, t0: Date.now() };

    this.send(ws, { t: 'hello', id, color, peers: [...this.peers].map(([pid, p]) => ({ id: pid, name: p.name, color: p.color, k: p.k, x: p.x, y: p.y })) });
    this.peers.set(id, me);
    this.broadcast({ t: 'join', id, name: me.name, color }, id);

    ws.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 200) return;
      // al massimo ~40 messaggi al secondo per persona
      const now = Date.now(); if (now - me.t0 > 1000) { me.t0 = now; me.n = 0; } if (++me.n > 40) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'm' && Number.isFinite(m.x) && Number.isFinite(m.y)) {
        me.k = Number.isInteger(m.k) ? Math.max(-2, Math.min(200, m.k)) : -1;
        me.x = Math.max(-0.5, Math.min(1.5, m.x)); me.y = Math.max(-0.5, Math.min(1.5, m.y));
        this.broadcast({ t: 'm', id, k: me.k, x: me.x, y: me.y }, id);
      } else if (m.t === 'n') { me.name = cleanName(m.name); this.broadcast({ t: 'n', id, name: me.name }, id); }
    });
    const bye = () => { if (this.peers.delete(id)) this.broadcast({ t: 'leave', id }); try { ws.close(); } catch {} };
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);

    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  broadcast(obj, except) { const s = JSON.stringify(obj); for (const [id, p] of this.peers) if (id !== except) { try { p.ws.send(s); } catch {} } }
}

export default {
  // nessun accesso diretto: il Durable Object si usa solo tramite il collegamento (binding) dal sito
  fetch() { return new Response('Not found', { status: 404 }); },
};
