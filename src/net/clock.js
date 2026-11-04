/**
 * Master-clock maths for the online race. PURE: no DOM, no timers — a client
 * feeds it pong replies, it keeps the best estimate of the server clock.
 *
 * Why the app-level ping/pong instead of WebSocket pings? The browser API
 * hides protocol-level pings from JavaScript, so the client sends `ping`
 * {t: local send time}; the server replies `pong` {t: echoed, s: server clock}.
 * With a roughly symmetric wire, the server's "now" sits in the middle of the
 * round trip, giving the offset from the client clock to the server clock:
 *
 *   rtt    = receiveTime − sentT
 *   offset = serverS + rtt / 2 − receiveTime   (serverNow = localNow + offset)
 *
 * Network jitter inflates individual rtts, so the estimate always comes from
 * the sample with the SMALLEST rtt of the last N pongs: the fast samples
 * waited least in queues, so distorted least. Clients keep re-syncing (the
 * lobby pings at ~1 Hz) before the shared start moment counts down, and the
 * same serverNow() decides when ONE shared goAt has arrived — so every
 * client, whatever its wire, flips the ampel to green at the same server
 * instant.
 * Counts toward the size budget — kept tight.
 */

/** One clock. history = pong samples kept for the min-rtt filter. */
export function createClock(history = 8) {
  const samples = []; // {rtt, offset}, newest last
  return {
    /** Feed one pong: echoedT = our send timestamp echoed back, serverAt = server clock reading, receiveTime = local receive time. */
    onPong(echoedT, serverAt, receiveTime) {
      const rtt = Math.max(0, receiveTime - echoedT);
      samples.push({ rtt, offset: serverAt + rtt / 2 - receiveTime });
      while (samples.length > history) samples.shift();
    },
    /** Best offset estimate, or null before the first pong. */
    offset() {
      let best = null;
      for (const s of samples) if (!best || s.rtt < best.rtt) best = s;
      return best ? best.offset : null;
    },
    /** True once at least one pong has been measured. */
    synced() { return samples.length > 0; },
    /** Convert a local time to the master clock. Returns null while unsynced. */
    serverNow(localNow) {
      const offset = this.offset();
      return offset === null ? null : localNow + offset;
    },
  };
}
