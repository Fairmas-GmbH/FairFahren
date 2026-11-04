// In-memory stand-in for the real network: FakeServer hands out FakeConnection
// pairs (server side ↔ client side) whose messages are delivered straight to
// the peer's handler — immediately, after N ms on FakeNet's virtual clock, or
// never (drop). Race logic (phase 2) is driven end-to-end through these pairs
// with deterministic timestamps: no sockets, no real timers.
//
// The connection shape mirrors the real WsConnection from ws.js:
// send(text), close(), onMessage(cb), onClose(cb), plus a server-assigned id.

// Virtual clock + FIFO event queue. advance(ms) runs everything that became
// due, in schedule order; handlers may schedule follow-ups mid-advance.
export class FakeNet {
  constructor(start = 0) {
    this.now = start;
    this.queue = []; // { at, seq, fn }, kept sorted by (at, seq)
    this._seq = 0;
  }

  schedule(delay, fn) {
    this.queue.push({ at: this.now + Math.max(0, delay), seq: this._seq++, fn });
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  advance(ms) {
    const end = this.now + ms;
    while (this.queue.length && this.queue[0].at <= end) {
      this.now = this.queue[0].at;
      this.queue.shift().fn();
    }
    this.now = end;
  }
}

const resolve = (v) => (typeof v === 'function' ? v() : v);

// One end of a wire pair. opts: { latency = 0, drop = false } — plain values or
// functions, re-read on every send, so tests can inject jitter or selective loss.
export class FakeConnection {
  constructor(net, opts = {}) {
    this.net = net;
    this.opts = opts;
    this.id = 0;
    this.peer = null;
    this.onMessage = null;
    this.onClose = null;
    this.closed = false;
  }

  send(text) {
    if (this.closed || resolve(this.opts.drop)) return;
    const peer = this.peer;
    const deliver = () => !peer.closed && peer.onMessage?.(text);
    const delay = resolve(this.opts.latency ?? 0);
    if (delay > 0) this.net.schedule(delay, deliver); else deliver();
  }

  // Clean disconnect: the closer learns at once, the peer after the wire delay.
  // `code`/`reason` are ignored for delivery but recorded, so tests can verify
  // reject messages (the real WsConnection sends them in a close frame).
  close(code, reason) {
    if (this.closed) return;
    this.closed = true;
    this.closedWith = { code, reason };
    this.onClose?.();
    const peer = this.peer;
    const notify = () => peer._peerClosed();
    const delay = resolve(this.opts.latency ?? 0);
    if (delay > 0) this.net.schedule(delay, notify); else notify();
  }

  _peerClosed() {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }
}

// Creates the pairs: every connect() makes a server-side connection (handed to
// onConnect, with a fresh id) and returns the matching client side.
export class FakeServer {
  constructor(net) {
    this.net = net;
    this.onConnect = null;
    this._nextId = 1;
  }

  // Both directions share clientOpts unless serverOpts is given explicitly.
  connect(clientOpts = {}, serverOpts = clientOpts) {
    const serverConn = new FakeConnection(this.net, serverOpts);
    const clientConn = new FakeConnection(this.net, clientOpts);
    serverConn.peer = clientConn;
    clientConn.peer = serverConn;
    serverConn.id = this._nextId++;
    this.onConnect?.(serverConn);
    return clientConn;
  }
}
