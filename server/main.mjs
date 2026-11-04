// FairFahren game server: serves the static game exactly like `npm start`, and
// speaks WebSocket on /ws — the race rules (raceState.js) are wired onto every
// accepted connection below. Usage: node server/main.mjs [--seed N] [port]
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static.mjs';
import { acceptConnection } from './ws.js';
import { createRaceState } from './raceState.js';
import { encode } from './protocol.js';
import { DEFAULT_CITY } from '../src/world/cityGen.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Composes the game server. `onConnect(conn)` receives every accepted
// WebSocket connection: { send(text), close(code, reason), onMessage(cb), onClose(cb) }.
export function createGameServer({ onConnect } = {}) {
  const server = createServer(serveStatic(ROOT));
  const connections = new Set();
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    const conn = acceptConnection(socket, req.headers);
    if (!conn) return; // invalid handshake: already answered and destroyed
    connections.add(conn);
    onConnect?.(conn); // sets conn.onMessage / conn.onClose as it sees fit
    // Keep our set tidy whatever the caller did: run our cleanup after theirs.
    const callerClose = conn.onClose;
    conn.onClose = () => {
      connections.delete(conn);
      callerClose?.();
    };
  });
  return { server, connections };
}

if (import.meta.main) {
  // Usage: node server/main.mjs [--seed N] [port]. Flag and positional port
  // are parsed apart, in either order; SEED env also works.
  const argv = process.argv.slice(2);
  const seedIx = argv.indexOf('--seed');
  const seed = seedIx === -1
    ? (process.env.SEED !== '' && Number.isInteger(Number(process.env.SEED)) ? Number(process.env.SEED) : DEFAULT_CITY.seed)
    : Number(argv[seedIx + 1]);
  if (!Number.isInteger(seed) || seed < 0) {
    console.error(`Usage: node server/main.mjs [--seed <non-negative integer>] [port]  (got "--seed ${argv[seedIx + 1]}")`);
    process.exit(1);
  }
  const PORT = Number(argv.filter((a, i) => i !== seedIx && (i !== seedIx + 1 || seedIx === -1))[0] ?? process.env.PORT ?? 8080);
  // The server owns the rules and the seed; clients regenerate the same city
  // from it (phase 3). Rules are pure (raceState.js) and get everything from
  // here injected, so tests drive them over FakeNet instead of sockets.
  const race = createRaceState({
    seed,
    now: () => Date.now(),
    send: (conn, type, data) => conn.send(encode(type, data)),
    close: (conn, code, reason) => conn.close(code, reason),
    schedule: (delayMs, fn) => setTimeout(fn, delayMs), // real timers; tests swap in FakeNet.schedule
  });
  // 0.0.0.0: reachable from other machines on the intranet, not just localhost.
  createGameServer({
    onConnect: (conn) => {
      race.connect(conn);
      conn.onMessage = (text) => race.onMessage(conn, text);
      conn.onClose = () => race.disconnect(conn);
    },
  }).server.listen(PORT, '0.0.0.0', () =>
    console.log(`FairFahren server on http://0.0.0.0:${PORT} (game + WebSocket /ws, race seed ${seed})`));
}
