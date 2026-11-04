// RFC 6455 WebSocket, hand-rolled on the raw socket node:http hands us from the
// 'upgrade' event. Pure, byte-level pieces (handshake, framing, masking) that
// the unit tests can drive with Buffers. Scope: small unfragmented frames only
// (this is a LAN game with tiny JSON messages), so no fragmentation/extensions.
import { createHash } from 'node:crypto';

export const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OP = { text: 0x1, close: 0x8, ping: 0x9, pong: 0xa };
export const MAX_PAYLOAD = 65535; // frames above this are rejected (small frames only)

// --- Handshake ---

// RFC 6455 §4.2.2: base64(SHA-1(key + GUID)).
export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

const KEY_RE = /^[A-Za-z0-9+/]{22}==$/; // base64 of the required 16 random bytes

// Validate the headers of an upgrade request (node:http lowercases them).
// Returns { ok: true, key } or { ok: false, status, reason, extra }.
export function validateUpgrade(h) {
  if (!h || h.upgrade?.toLowerCase() !== 'websocket')
    return { ok: false, status: 400, reason: 'Bad Request' };
  const tokens = (h.connection ?? '').toLowerCase().split(',').map((s) => s.trim());
  if (!tokens.includes('upgrade'))
    return { ok: false, status: 400, reason: 'Bad Request' };
  if (h['sec-websocket-version'] !== '13')
    return { ok: false, status: 426, reason: 'Upgrade Required', extra: 'Sec-WebSocket-Version: 13\r\n' };
  const key = h['sec-websocket-key'];
  if (typeof key !== 'string' || !KEY_RE.test(key))
    return { ok: false, status: 400, reason: 'Bad Request' };
  return { ok: true, key };
}

// The full 101 reply that switches the HTTP connection into WebSocket mode.
export function handshakeResponse(key) {
  return `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`;
}

// --- Framing ---

// XOR the payload with the 4 mask bytes, in place (symmetric: mask twice = original).
export function applyMask(data, mask) {
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
  return data;
}

// Encode one unmasked server frame (server frames are never masked, RFC §5.1).
export function encodeFrame(opcode, payload = '') {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
  if (data.length > MAX_PAYLOAD) throw new Error('ws: frame too large');
  if (opcode > 7 && data.length > 125) throw new Error('ws: control frame payload > 125');
  const head = data.length < 126 ? Buffer.from([0x80 | opcode, data.length]) : Buffer.alloc(4);
  if (head.length === 4) { // 126..65535 bytes: 16-bit extended length
    head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(data.length, 2);
  }
  return Buffer.concat([head, data]);
}

const KNOWN_OPCODES = new Set([0x1, 0x2, 0x8, 0x9, 0xa]);

// Try to decode ONE frame from the front of `buf`. Returns null while more bytes
// are needed; otherwise { fin, opcode, masked, payload, bytes } with the payload
// unmasked and copied (the caller keeps `buf`) and `bytes` = total frame size.
// Throws on protocol violations (reserved bits, fragments, oversized control frames).
export function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0, rsv = buf[0] & 0x70, opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f, off = 2;
  if (rsv !== 0) throw new Error('ws: reserved bits set');
  if (!KNOWN_OPCODES.has(opcode)) throw new Error('ws: reserved opcode');
  if (!fin) throw new Error('ws: fragmented frames not supported');
  if (len === 127) throw new Error('ws: 64-bit frame lengths not supported');
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); off = 4;
  }
  if (opcode > 7 && len > 125) throw new Error('ws: control frame payload > 125');
  if (masked && buf.length < off + 4) return null;
  const mask = masked ? buf.subarray(off, off + 4) : null;
  if (masked) off += 4;
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) applyMask(payload, mask);
  return { fin, opcode, masked, payload, bytes: off + len };
}

// Incremental reader for a stream: pass it arbitrary chunks, it emits complete
// frames via `onFrame` in arrival order and lets protocol errors propagate.
export function createFrameReader(onFrame) {
  let buf = null;
  return (chunk) => {
    buf = buf ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
    for (;;) {
      if (!buf) return;
      const f = decodeFrame(buf);
      if (!f) return;
      buf = f.bytes < buf.length ? buf.subarray(f.bytes) : null;
      onFrame(f);
    }
  };
}

// --- Connection: one live WebSocket over an upgraded socket ---

// 2-byte close code + optional utf8 reason (control payload limit: 125 bytes).
function closePayload(code, reason) {
  const r = Buffer.from(String(reason ?? ''), 'utf8').subarray(0, 123);
  return Buffer.concat([Buffer.from([code >> 8, code & 0xff]), r]);
}

// Validate the upgrade, write the 101 reply, wrap the socket. Returns a
// WsConnection, or null after answering + closing an invalid handshake.
// (socket.end, never destroy-after-write: destroy discards unflushed bytes.)
export function acceptConnection(socket, headers) {
  const v = validateUpgrade(headers);
  if (!v.ok) {
    socket.on('error', () => {});
    socket.end(`HTTP/1.1 ${v.status} ${v.reason}\r\n${v.extra ?? ''}Connection: close\r\nContent-Length: 0\r\n\r\n`);
    return null;
  }
  socket.write(handshakeResponse(v.key));
  return new WsConnection(socket);
}

export class WsConnection {
  // Text frames come out as onMessage(string); pings are answered with pongs
  // automatically; a close from either side ends the socket and fires onClose
  // exactly once. Binary frames are refused (the protocol is JSON text only).
  constructor(socket) {
    this.socket = socket;
    this.onMessage = null;
    this.onClose = null;
    this.open = true;
    this.closing = false;
    socket.setNoDelay(true); // latency matters more than bandwidth here
    const reader = createFrameReader((f) => this._onFrame(f));
    socket.on('data', (chunk) => { try { reader(chunk); } catch { this._close(1002, 'protocol error'); } });
    socket.on('error', () => {}); // socket errors surface as 'close', never a crash
    socket.on('close', () => this._closed());
  }

  send(text) { this._send(OP.text, Buffer.from(String(text), 'utf8')); }
  close(code = 1000, reason = '') { this._close(code, reason); }

  _onFrame(f) {
    if (f.opcode === OP.ping) return this._send(OP.pong, f.payload);
    if (f.opcode === OP.pong) return; // RTT is measured with app-level ping/pong messages
    if (f.opcode === OP.close) {
      const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1000;
      return this._close(code, ''); // echo the close, then end
    }
    if (f.opcode === OP.text) return this.onMessage?.(f.payload.toString('utf8'));
    this._close(1003, 'binary not supported');
  }

  _send(opcode, payload) {
    if (this.closing) return;
    try { this.socket.write(encodeFrame(opcode, payload)); } catch { /* socket died mid-write */ }
  }

  // Send a close frame, then end the socket (end flushes; destroy would not).
  _close(code, reason) {
    if (this.closing) return;
    this._send(OP.close, closePayload(code, reason));
    this.closing = true;
    this.socket.end();
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.onClose?.();
  }
}
