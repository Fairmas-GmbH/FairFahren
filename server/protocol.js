// The multiplayer message language: one entry per message type, declaring its
// direction ('cs' client → server, 'sc' server → client), its wire fields and
// its design rate. One shared encode/decode pair is driven by those entries,
// so every packet is validated against the same definitions that produce the
// protocol table in NOTES.md (`node tools/protocol-table.mjs`).
//
// Wire format: JSON text frames tagged with `type` — messages are tiny and the
// intranet is fast, so readable beats compact. All times are milliseconds in
// the shared server clock (clients learn their offset via ping/pong, because
// the browser's WebSocket API hides the protocol-level ping/pong from JS).

export const STAGES = ['lobby', 'countdown', 'racing', 'finished', 'ceremony'];
export const MAX_PLAYERS = 4;

const err = (where, why) => new Error(`protocol: ${where} ${why}`);

// --- Field validators (used by encode AND decode, so both sides agree) ---

function str(v, w) {
  if (typeof v !== 'string' || v.length < 1 || v.length > 24) throw err(w, 'must be a 1..24 char string');
  return v;
}
function num(v, w) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw err(w, 'must be a finite number');
  return v;
}
function idNum(v, w) {
  if (!Number.isInteger(v) || v < 1) throw err(w, 'must be a positive integer');
  return v;
}
function seedNum(v, w) {
  if (!Number.isInteger(v) || v < 0) throw err(w, 'must be a non-negative integer');
  return v;
}
function stageOf(v, w) {
  if (!STAGES.includes(v)) throw err(w, `must be one of ${STAGES.join('|')}`);
  return v;
}
function rosterOf(v, w) {
  if (!Array.isArray(v) || v.length > MAX_PLAYERS) throw err(w, `must be an array of at most ${MAX_PLAYERS} players`);
  return v.map((p, i) => {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) throw err(`${w}[${i}]`, 'must be an object');
    for (const k of Object.keys(p)) if (k !== 'id' && k !== 'name') throw err(`${w}[${i}]`, `has unknown field ${k}`);
    if (!('id' in p) || !('name' in p)) throw err(`${w}[${i}]`, 'needs id and name');
    return { id: idNum(p.id, `${w}[${i}].id`), name: str(p.name, `${w}[${i}].name`) };
  });
}

const tOrNull = (v, w) => (v === null ? null : num(v, w));
// A jump-start penalty: milliseconds the server added to a finisher's time, or
// null on a DNF row (no crossing time, nothing to penalise).
const penOf = (v, w) => {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw err(w, 'must be a non-negative number or null');
  return v;
};
const boolOf = (v, w) => {
  if (typeof v !== 'boolean') throw err(w, 'must be a boolean');
  return v;
};
// One results-table row for the settled race: finished players first in
// official order (time + penalty, then earliest report), DNFs last with
// t = null and pen = null.
const resultsOf = (v, w) => {
  if (!Array.isArray(v) || v.length > MAX_PLAYERS) throw err(w, `must be an array of at most ${MAX_PLAYERS} players`);
  return v.map((r, i) => {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) throw err(`${w}[${i}]`, 'must be an object');
    for (const k of Object.keys(r)) if (k !== 'id' && k !== 'name' && k !== 't' && k !== 'dnf' && k !== 'pen') throw err(`${w}[${i}]`, `has unknown field ${k}`);
    if (!('id' in r) || !('name' in r) || !('t' in r) || !('dnf' in r) || !('pen' in r)) throw err(`${w}[${i}]`, 'needs id, name, t, dnf and pen');
    return {
      id: idNum(r.id, `${w}[${i}].id`),
      name: str(r.name, `${w}[${i}].name`),
      t: tOrNull(r.t, `${w}[${i}].t`),
      dnf: boolOf(r.dnf, `${w}[${i}].dnf`),
      pen: penOf(r.pen, `${w}[${i}].pen`),
    };
  });
};

// --- The registry ---

export const MESSAGES = {
  // client → server
  join:       { dir: 'cs', rate: 'once, on entering the lobby', fields: { name: str } },
  name:       { dir: 'cs', rate: 'on change, in lobby',          fields: { name: str } },
  start:      { dir: 'cs', rate: 'user-triggered',               fields: {} },
  pos:        { dir: 'cs', rate: '15 Hz while racing',           fields: { x: num, z: num, h: num, s: num } },
  finish:     { dir: 'cs', rate: 'once per race',                fields: { t: num } },
  jump:       { dir: 'cs', rate: 'user-triggered, before green', fields: {} },
  again:      { dir: 'cs', rate: 'user-triggered, in ceremony',  fields: {} },
  ping:       { dir: 'cs', rate: 'about 1 Hz while syncing',     fields: { t: num } },
  // server → client
  roster:     { dir: 'sc', rate: 'on change',                    fields: { players: rosterOf, seed: seedNum } },
  countdown:  { dir: 'sc', rate: 'once per race',                fields: { goAt: num } },
  go:         { dir: 'sc', rate: 'once per race',                fields: { goAt: num } },
  posRelay:   { dir: 'sc', rate: 'per player, 15 Hz',            fields: { id: idNum, x: num, z: num, h: num, s: num } },
  stage:      { dir: 'sc', rate: 'on change',                    fields: { stage: stageOf } },
  disconnect: { dir: 'sc', rate: 'on player leaving',            fields: { id: idNum } },
  pong:       { dir: 'sc', rate: 'on ping',                      fields: { t: num, s: num } },
  finishInfo: { dir: 'sc', rate: 'per finisher, once',           fields: { id: idNum, t: num } },
  jumped:     { dir: 'sc', rate: 'per jump, once',              fields: { id: idNum, pen: num } },
  results:    { dir: 'sc', rate: 'once, when the race is settled', fields: { players: resultsOf } },
};

// --- The encode/decode pair ---

// encode(type, data) → JSON string, fields validated on the way out.
export function encode(type, data) {
  const def = MESSAGES[type];
  if (!def) throw err(type, 'is not a known message type');
  const out = { type };
  for (const [f, check] of Object.entries(def.fields)) out[f] = check(data?.[f], `${type}.${f}`);
  return JSON.stringify(out);
}

// decode(text) → { type, data }, or throws on anything unknown or malformed:
// bad JSON, non-objects, unknown types, missing/unknown fields, wrong value types.
export function decode(text) {
  let m = null;
  try { m = JSON.parse(text); } catch { /* handled below */ }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) throw err('packet', 'must be a JSON object');
  const def = MESSAGES[m.type];
  if (!def) throw err('packet', `unknown message type ${JSON.stringify(m.type)}`);
  const known = Object.keys(def.fields);
  for (const k of Object.keys(m)) if (k !== 'type' && !known.includes(k)) throw err(m.type, `unknown field ${k}`);
  const data = {};
  for (const [f, check] of Object.entries(def.fields)) data[f] = check(m[f], `${m.type}.${f}`);
  return { type: m.type, data };
}

// Markdown table of the whole protocol, generated from the registry. NOTES.md
// embeds it between markers; a test keeps the two from drifting apart.
export function protocolTable() {
  const rows = Object.entries(MESSAGES).map(([name, d]) =>
    `| ${name} | ${d.dir === 'cs' ? 'client → server' : 'server → client'} | ${Object.keys(d.fields).join(' ') || '—'} | ${d.rate} |`);
  return ['| type | from | fields | rate |', '|---|---|---|---|', ...rows].join('\n');
}
