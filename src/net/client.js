/**
 * The online client core: connection + lobby flow, one source of race state
 * for the UI. PURE: the transport (`conn`: send/onMessage/onClose), the clock
 * (`now`) and the interval helper (`every` → cancel fn) are all injected, so
 * tests drive whole lobbies over FakeNet on a virtual clock and the browser
 * wires them to a real WebSocket. `on` is a plain callbacks object.
 *
 * Wire messages are JSON text frames, encoded/decoded by server/protocol.js
 * (plain ES module, browser-safe). Malformed or unknown frames are dropped
 * silently, exactly like raceState drops its garbage. Counts toward the size
 * budget — kept tight.
 */
import { decode, encode } from '../../server/protocol.js';
import { createClock } from './clock.js';

// Close codes the server uses to reject a join (see NOTES.md): a fifth player
// in a full lobby (4000), a connection arriving mid-race (4001).
const TURNED_AWAY = new Set([4000, 4001]);

export function createNetClient({ conn, name, now, every, on }) {
  const clock = createClock();
  let stage = 'connecting'; // lobby state arrives with the first message
  let players = []; // last roster
  let seed = null;
  let seenSeed = null; // guard so seedChange fires exactly once per distinct seed
  let goAt = null; // shared start moment from countdown/go
  let finishSent = false; // finishing is once per race
  let closed = false;

  // ~1 Hz application ping keeps the master clock synced: the pong's echoed
  // `t` and server stamp `s`, read with the injected receive time, form one
  // min-rtt sample in the clock.
  every(1000, () => { if (!closed) conn.send(encode('ping', { t: now() })); });

  conn.onMessage = (text) => {
    let m = null;
    try { m = decode(text); } catch { return; } // malformed/unknown: drop silently
    const d = m.data;
    switch (m.type) {
      case 'roster': // every roster message replaces the local roster
        players = d.players;
        seed = d.seed;
        if (stage === 'connecting') stage = 'lobby'; // a roster IS the lobby: joined and accepted
        on.roster?.(players, seed);
        if (seed !== seenSeed) { seenSeed = seed; on.seedChange?.(seed); } // rebuild city+mesh
        break;
      case 'stage':
        stage = d.stage;
        if (stage === 'countdown') finishSent = false; // a rematch race must report again
        on.stage?.(stage);
        break;
      case 'countdown':
      case 'go':
        goAt = d.goAt;
        on.goAt?.(goAt);
        break;
      case 'posRelay': // stamped with our receive time for the interp buffer
        on.peerPos?.({ id: d.id, t: now(), x: d.x, z: d.z, h: d.h, s: d.s });
        break;
      case 'disconnect':
        on.peerGone?.(d.id);
        break;
      case 'pong':
        clock.onPong(d.t, d.s, now());
        break;
      case 'finishInfo':
        on.finishInfo?.({ id: d.id, t: d.t });
        break;
      case 'jumped': // phase 4: someone moved before green; the server fixed the penalty
        on.jumped?.({ id: d.id, pen: d.pen });
        break;
      case 'results':
        on.results?.(d.players);
        break;
    }
  };

  conn.onClose = (code, reason) => {
    if (closed) return;
    closed = true;
    if (TURNED_AWAY.has(code)) { stage = 'turnedAway'; on.turnedAway?.(code, reason); }
    else { stage = 'dropped'; on.dropped?.(reason); } // missing code = a plain drop
  };

  conn.send(encode('join', { name }));

  // Outgoing helpers. Each send is gated to the stage(s) that make it legal,
  // so a UI slip cannot put out-of-context messages on the wire.
  const sendIf = (legal, type, data) => { if (!closed && legal) conn.send(encode(type, data)); };

  return {
    clock, // master clock: the ampel/goAt comparison uses clock.serverNow()
    get stage() { return stage; },
    get players() { return players; },
    get seed() { return seed; },
    get canStart() { return stage === 'lobby' && players.length >= 2; },
    get goAt() { return goAt; },
    /** Stream one car state; legal from the countdown (freeze phase) on. */
    sendPos(state) { sendIf(['countdown', 'racing', 'finished'].includes(stage), 'pos', state); },
    /** Report the crossing time once per race; legal while racing or after. */
    sendFinish(t) {
      if (closed || finishSent || (stage !== 'racing' && stage !== 'finished')) return;
      finishSent = true;
      conn.send(encode('finish', { t }));
    },
    /** Ask for a race start; only meaningful as two-plus players in the lobby. */
    startRace() { sendIf(stage === 'lobby' && players.length >= 2, 'start', {}); },
    /** Low-level escape hatch for future phases (e.g. phase-4 rematch). */
    sendRaw(text) { if (!closed) conn.send(text); },
  };
}
