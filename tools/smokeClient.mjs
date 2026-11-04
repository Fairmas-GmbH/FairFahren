// Throwaway smoke player for manual phase-2 testing: connects to the local
// game server's WebSocket, joins with a name, prints everything the server
// says, starts the race when two are in the lobby, streams fake positions
// while racing and reports a finish. Run two or three of these and watch the
// race happen on the REAL socket path that the fakeNet unit tests only mirror.
//   node tools/smokeClient.mjs <name> [port]
import { encode, decode } from '../server/protocol.js';

const name = process.argv[2] ?? 'Smoke';
const port = process.argv[3] ?? process.env.PORT ?? '8080';
const ws = new WebSocket(`ws://localhost:${port}/ws`);
let id = null;

ws.onopen = () => {
  console.log(`[${name}] connected — joining`);
  ws.send(encode('join', { name }));
};
ws.onerror = (err) => console.log(`[${name}] connection error:`, err?.message ?? err);
ws.onmessage = (e) => {
  let m;
  try { m = decode(e.data); } catch { console.log(`[${name}] ?? ${e.data}`); return; }
  console.log(`[${name}] ←`, m.type, m.data);
  if (m.type === 'roster') {
    id = m.data.players.find((p) => p.name === name)?.id ?? id;
    if (m.data.players.length >= 2) ws.send(encode('start', {}));
  }
  if (m.type === 'go') {
    // Fake driving: a taxi-feeling arc down the track, 15 Hz, then a finish.
    let x = 0, tick = 0;
    const timer = setInterval(() => {
      tick++;
      x += 1.5;
      ws.send(encode('pos', { x, z: 7.5 + Math.sin(tick / 10) * 3, h: Math.PI / 2, s: 15 }));
      if (tick === 40) {
        clearInterval(timer);
        ws.send(encode('finish', { t: Date.now() })); // ms in the shared server clock
      }
    }, 66);
  }
};
ws.onclose = ({ code, reason }) => console.log(`[${name}] closed`, code, reason);
