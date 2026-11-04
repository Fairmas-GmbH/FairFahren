// The rules of the race as one PURE module: no sockets, no real timers, no
// Math.random. Everything that touches the outside world is injected —
//
//   now()      → server time in ms (the master clock every decision is based on)
//   send(conn, type, data)      → deliver an outgoing message
//   close(conn, code, reason)   → reject a connection
//   schedule(delayMs, fn)       → a cancellable-by-us timer (setTimeout / FakeNet.schedule)
//
// That keeps the whole state machine (lobby → countdown → racing → finished →
// ceremony) runnable in node:test against FakeNet pairs, and lets main.mjs
// wire the real WebSocket connections into the same handlers.
//
// Official order: the server settles finish times — clients only REPORT, so a
// lying or late client can't change the podium. Ties go to the earliest report
// (arrival order), which keeps the result deterministic.
import { decode, encode, MAX_PLAYERS } from './protocol.js';

// Close codes for turned-away connections (NOTES.md documents these).
export const CLOSE_FULL = 4000; // 4 already in the lobby
export const CLOSE_STARTED = 4001; // race already started

// The jump-start bonus (phase 4): moving before the shared green costs this
// much official time. One constant, set by the server alone — clients only
// report the attempt (`jump`), never the sentence.
export const JUMP_PENALTY_MS = 3000;

export function createRaceState({
  seed: initialSeed,
  now = Date.now,
  send,
  close,
  schedule,
  countdownMs = 3000,
  resultsMs = 2000, // pause between the results table and the podium
  ceremonyAfterWinnerMs = 30000, // brief rule: ceremony at latest 30 s after the winner
}) {
  if (!Number.isInteger(initialSeed) || initialSeed < 0) throw new RangeError('raceState: seed must be a non-negative integer');
  let seed = initialSeed; // 'Nochmal' bumps this by exactly +1: the rematch drives the NEXT world

  const lobby = new Map(); // conn → nothing yet: connected, has not sent join
  const players = new Map(); // conn → { id, name, finish: {t, seq} | null, dnf, pen }
  let stage = 'lobby';
  let nextId = 1;
  let reportSeq = 0; // arrival order of finish reports, breaks time ties deterministically
  let goAt = null; // shared start moment, sent in countdown and go
  let winnerAt = null; // server time when the first finish was reported
  let settled = false; // results are out; final stage change pending

  const roster = () => Array.from(players.values(), (p) => ({ id: p.id, name: p.name }));
  const broadcast = (type, data) => {
    for (const [conn, p] of players) if (!p.gone) send(conn, type, data);
  };

  const toResults = () => {
    const byArrival = Array.from(players.values());
    // Official time = reported time + penalty (a jump start pushes a player
    // behind a clean finisher with a similar time); ties → earliest report.
    const official = (p) => p.finish.t + p.pen;
    const finished = byArrival.filter((p) => p.finish).sort((a, b) => official(a) - official(b) || a.finish.seq - b.finish.seq);
    // Everyone the race settled without a finish time is a DNF (disconnected
    // mid-race, or still driving when the 30 s window forced the result).
    const dnf = byArrival.filter((p) => !p.finish).sort((a, b) => a.id - b.id);
    return [...finished, ...dnf].map((p) => ({
      id: p.id, name: p.name, t: p.finish ? p.finish.t : null, dnf: !p.finish,
      pen: p.finish ? p.pen : null, // nothing to penalise without a crossing time
    }));
  };

  // Ceremony fires when everyone is home (finish or DNF — a disconnect never
  // blocks it, brief acceptance criterion) or, at the latest, 30 s after the
  // winner crossed. Exactly once. An all-DNF race (everyone quits before any
  // finish) settles straight away: no winner is coming to save it.
  const settle = () => {
    if (settled) return;
    const allDone = Array.from(players.values()).every((p) => p.finish || p.dnf);
    if (!allDone && (winnerAt === null || now() - winnerAt < ceremonyAfterWinnerMs)) return;
    settled = true;
    stage = 'finished';
    const results = toResults();
    broadcast('stage', { stage: 'finished' });
    broadcast('results', { players: results });
    schedule(resultsMs, () => {
      stage = 'ceremony';
      broadcast('stage', { stage: 'ceremony' });
    });
  };

  const startCountdown = () => {
    stage = 'countdown';
    goAt = now() + countdownMs;
    broadcast('stage', { stage: 'countdown' });
    broadcast('countdown', { goAt });
    schedule(countdownMs, () => {
      stage = 'racing';
      broadcast('stage', { stage: 'racing' });
      broadcast('go', { goAt });
    });
  };

  // 'Nochmal': only from the ceremony, one press throws the whole race away
  // and puts everyone back on a fresh grid — seed + 1 (the players ride the
  // NEXT generated world, deterministic), per-player sheet wiped (ids and
  // names survive), and the shared-clock countdown starts over.
  const rematch = () => {
    seed += 1;
    reportSeq = 0;
    winnerAt = null;
    settled = false;
    for (const p of players.values()) { p.finish = null; p.dnf = false; p.pen = 0; p.gone = false; } // a dropped socket swallows its sends; its rider settles as DNF again if it never returns
    for (const [c] of players) send(c, 'roster', { players: roster(), seed });
    startCountdown();
  };

  // --- Handlers the transport layer calls ---

  // A new connection. In-lobby and under the cap → wait for join; anything
  // else → turned away with a documented close code before any game message.
  const connect = (conn) => {
    if (stage !== 'lobby') return close(conn, CLOSE_STARTED, 'race already started');
    if (players.size + lobby.size >= MAX_PLAYERS) return close(conn, CLOSE_FULL, 'lobby full');
    lobby.set(conn);
  };

  // One text message from a connection, already framed. Malformed or
  // out-of-context messages are dropped silently — no state, no crash.
  const onMessage = (conn, text) => {
    let m = null;
    try { m = decode(text); } catch { return; } // unknown/malformed: drop
    const player = players.get(conn);
    switch (m.type) {
      case 'join': {
        if (stage !== 'lobby' || !lobby.has(conn) || player) return;
        lobby.delete(conn);
        players.set(conn, { id: nextId++, name: m.data.name, finish: null, dnf: false, pen: 0 });
        for (const [c] of players) send(c, 'roster', { players: roster(), seed });
        break;
      }
      case 'name': {
        if (stage !== 'lobby' || !player) return;
        player.name = m.data.name;
        broadcast('roster', { players: roster(), seed });
        break;
      }
      case 'start': {
        if (stage !== 'lobby' || !player) return; // start gate: ≥ 2 players
        if (players.size >= 2) startCountdown();
        break;
      }
      case 'jump': {
        // Physics-frozen client tried to move. Only a crime during the
        // countdown strictly before green, and only the first one: the server
        // alone fixes the penalty, the reporter gets no say in the size of it.
        if (stage !== 'countdown' || now() >= goAt || !player || player.gone || player.pen) return;
        player.pen = JUMP_PENALTY_MS;
        broadcast('jumped', { id: player.id, pen: JUMP_PENALTY_MS });
        break;
      }
      case 'again': {
        if (stage !== 'ceremony' || !player || player.gone) return;
        rematch();
        break;
      }
      case 'pos': {
        if (!['countdown', 'racing', 'finished'].includes(stage) || !player || player.gone) return;
        const { x, z, h, s } = m.data;
        for (const [other, peer] of players) if (other !== conn && !peer.gone) send(other, 'posRelay', { id: player.id, x, z, h, s });
        break;
      }
      case 'finish': {
        // Reports only while actually racing — after the results are settled
        // (all home or the 30 s force) a late report would contradict the
        // podium every client already received, so it stays DNF.
        if (stage !== 'racing' || !player || player.finish || player.dnf) return;
        if (m.data.t < 0) return; // negative race times are nonsense, not late
        player.finish = { t: m.data.t, seq: reportSeq++ };
        if (winnerAt === null) {
          winnerAt = now();
          schedule(ceremonyAfterWinnerMs, settle); // the race cannot outlive the winner by 30 s
        }
        broadcast('finishInfo', { id: player.id, t: m.data.t });
        settle();
        break;
      }
      case 'ping': {
        if (!player && !lobby.has(conn)) return;
        send(conn, 'pong', { t: m.data.t, s: now() }); // echo + server clock reading
        break;
      }
    }
  };

  // A connection went away. Before join → forget it; a racer → marked gone and
  // DNF (stays on the podium, never blocks the ceremony); in the lobby → out
  // of the roster.
  const disconnect = (conn) => {
    if (lobby.delete(conn)) return;
    const player = players.get(conn);
    if (!player || player.gone) return;
    player.gone = true;
    if (stage === 'lobby') {
      players.delete(conn);
      broadcast('disconnect', { id: player.id });
      broadcast('roster', { players: roster(), seed });
      return;
    }
    player.dnf = true;
    broadcast('disconnect', { id: player.id });
    settle(); // a DNF can be the last "result" the race was waiting for
  };

  return { connect, onMessage, disconnect, get stage() { return stage; }, get roster() { return roster(); } };
}
