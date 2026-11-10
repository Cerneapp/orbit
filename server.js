// Servidor de sinalização do Orbit (salas, senha, dono, chat, reações).
// O vídeo/áudio vai direto entre os navegadores (WebRTC).
// Para TURN: defina TURN_URL, TURN_USER e TURN_PASS nas variáveis de ambiente.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const J = JSON.stringify;
const ice = () => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' },
  ...(process.env.TURN_URL ? [{ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS }] : [])] });

const srv = http.createServer((q, r) => {
  if (q.url === '/ice') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(J(ice())); }
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
});
const wss = new WebSocketServer({ server: srv });
const rooms = new Map();
let n = 0;
const all = (set, o) => set.forEach(w => w.send(J(o)));

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !ws.room) {
      const room = String(m.room || '').slice(0, 40);
      const id = String(++n);
      const set = rooms.get(room) || Object.assign(new Map(), { pass: String(m.pass || '').slice(0, 40), owner: id, restrict: false });
      if (set.size && set.pass && m.pass !== set.pass) return ws.send(J({ t: 'denied', wrong: !!m.pass }));
      ws.room = room; ws.id = id; ws.name = String(m.name || 'Anônimo').slice(0, 24);
      rooms.set(room, set);
      ws.send(J({ t: 'welcome', id, owner: set.owner, restrict: set.restrict,
        peers: [...set.values()].map(w => ({ id: w.id, name: w.name })) }));
      all(set, { t: 'join', id, name: ws.name });
      set.set(id, ws);
      return;
    }
    const set = rooms.get(ws.room); if (!set) return;
    const isOwner = ws.id === set.owner;
    if (m.t === 'sig') { const w = set.get(m.to); w && w.send(J({ t: 'sig', from: ws.id, d: m.d })); }
    else if (m.t === 'chat') all(set, { t: 'chat', name: ws.name, text: String(m.text).slice(0, 500), ts: Date.now() });
    else if (m.t === 'react') all(set, { t: 'react', e: String(m.e).slice(0, 4) });
    else if (m.t === 'restrict' && isOwner) { set.restrict = !!m.v; all(set, { t: 'cfg', restrict: set.restrict }); }
    else if (m.t === 'kick' && isOwner) { const w = set.get(m.id); if (w && w !== ws) { w.send(J({ t: 'kicked' })); w.close(); } }
  });
  ws.on('close', () => {
    const set = rooms.get(ws.room); if (!set) return;
    set.delete(ws.id);
    all(set, { t: 'leave', id: ws.id });
    if (!set.size) return rooms.delete(ws.room);
    if (set.owner === ws.id) { set.owner = set.keys().next().value; all(set, { t: 'owner', id: set.owner }); }
  });
});
const port = process.env.PORT || 3000;
srv.listen(port, () => console.log('Orbit rodando em http://localhost:' + port));
