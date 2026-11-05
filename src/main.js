/**
 * FairFahren — entry point. Wires world generation, physics, rendering and input.
 *
 *   generateCity(seed) ──► city data ──► buildCityMesh ──► GPU (static)
 *                               └──► createLife ──► lifeMesh ──► GPU (every frame)
 *                               │
 *   Keyboard ──► stepCar ──► collideCar(city.colliders) ──► Camera ──► Renderer
 *
 * Solo (`npm start`) is the pre-multiplayer game, unchanged — no sockets, no
 * overlays. `?online` joins the race server instead: lobby overlay, shared
 * city, remote taxis, ampel start gate, finish line, results and podium
 * (phases 3–4, docs/plans/g-multiplayer).
 */
import { generateCity, streetAt } from './world/cityGen.js';
import { buildCityMesh } from './world/cityMesh.js';
import { TAXI, createCar, stepCar } from './vehicle/carPhysics.js';
import { collideCar } from './vehicle/collision.js';
import { buildTaxi, wheelOffsets } from './vehicle/taxiModel.js';
import { Renderer } from './gfx/renderer.js';
import { MeshBuilder, MAT, rgb } from './gfx/meshBuilder.js';
import { Keyboard } from './game/input.js';
import { Camera } from './game/camera.js';
import { Hud } from './game/hud.js';
import { SensorView } from './game/sensorView.js';
import { createSensorState, senseEnvironment } from './vehicle/sensors.js';
import { compose, translation, rotationX, rotationY, perspective, lookAt } from './core/math.js';
import { createLife, lifeMesh } from './world/life.js';
import { createNetClient } from './net/client.js';
import { encode } from '../server/protocol.js';
import { createInterp } from './net/remoteCar.js';
import { buildTrack } from './net/track.js';
import { ampelState, createStartGate, crossingTime, podiumLayout } from './net/raceLocal.js';

const PHYSICS_STEP = 1 / 120; // fixed timestep keeps physics deterministic
const ENV = {
  sunDir: normalize([0.35, 0.8, 0.5]),
  fogColor: [0.75, 0.79, 0.84], // hazy Berlin sky
  fogDensity: 0.0016,
  time: 0,
};

const seedParam = Number.parseInt(new URLSearchParams(location.search).get('seed') ?? '', 10);
const ONLINE = new URLSearchParams(location.search).has('online');
let city = generateCity(Number.isFinite(seedParam) ? { seed: seedParam } : {});

let renderer;
try {
  renderer = new Renderer(document.querySelector('canvas'));
} catch (err) {
  document.querySelector('#error').textContent = err.message;
  throw err;
}

let cityMesh = renderer.upload(buildCityMesh(city));
const taxiParts = buildTaxi(TAXI);
const taxi = { body: renderer.upload(taxiParts.body), wheel: renderer.upload(taxiParts.wheel), shadow: renderer.upload(taxiParts.shadow) };
const wheels = wheelOffsets(TAXI);

const car = createCar(city.spawn);
const keyboard = new Keyboard(window);
const camera = new Camera();
const hud = new Hud(document);
hud.set('seed', `Seed ${city.seed}`);
const sensorState = createSensorState();
const sensorView = new SensorView(document.querySelector('#sensors'));

// Handy for debugging in the browser console and for automated checks.
window.fairfahren = { city, car, camera, TAXI, sensorState, ENV };

let last = performance.now(), accumulator = 0, fps = 60;
let life = createLife(city), lifeGpu = null;

/** Street life: rebuilt every frame into one dynamic mesh, one draw call. scare: is the taxi visible? */
function drawLife(dt, scare) {
  window.fairfahren.life = life;
  lifeGpu = renderer.upload(lifeMesh(life, ENV.time, dt, car, scare), lifeGpu);
  renderer.draw(lifeGpu);
}

// ---------------------------------------------------------------------------
// Online mode
// ---------------------------------------------------------------------------
// Player colours, keyed by ROSTER position (every client gets the same roster
// array, so id → colour is identical everywhere). They paint the body-stripe
// skirt and the lobby legend dots; in-world name tags were cut (NOTES.md).
const COLORS = [0xd23b3b, 0x3b8fd2, 0x46c05f, 0xd2a24c];
const cssColor = (i) => `#${COLORS[i].toString(16).padStart(6, '0')}`;

const ui = {
  lobby: document.querySelector('#lobby'), joinRow: document.querySelector('#joinRow'),
  name: document.querySelector('#name'), roster: document.querySelector('#roster'),
  startBtn: document.querySelector('#startBtn'), status: document.querySelector('#netStatus'),
  results: document.querySelector('#results'), modal: document.querySelector('#modal'),
  modalMsg: document.querySelector('#modalMsg'), reloadBtn: document.querySelector('#reloadBtn'),
  againBtn: document.querySelector('#againBtn'), light: document.querySelector('#startLight'),
};

let net = null, selfId = null, goAt = null, gate = null, track = null, trackFor = '';
let gridded = false, prevCross = null, lastPos = 0, results = null;
let myFinish = null, pendingFinish = null, ownT = null, otherFinishes = [], podium = null, orbit = 0;
let terminated = false; // turn-away or dropped: the modal owns the screen from here
const remotes = new Map(); // peer id → { interp, spin }
const jumps = new Map(); // id → penalty ms, server-settled (we only report the attempt)
const stripes = COLORS.map(() => null); // colour skirt meshes, built lazily

if (ONLINE) setupOnline();

function setupOnline() {
  ui.lobby.hidden = false;
  ui.name.focus();
  document.querySelector('#joinBtn').onclick = join; // createNetClient sends 'join'
  ui.startBtn.onclick = () => net?.startRace(); // client.js gates stage + roster size
  ui.reloadBtn.onclick = () => location.reload();
  ui.againBtn.onclick = () => net?.sendRaw(encode('again', {})); // only legal in ceremony
}

function join() {
  if (net) return;
  document.querySelector('#joinBtn').disabled = true;
  const ws = new WebSocket(`ws://${location.host}/ws`);
  // The net client fills the two callback slots; the WebSocket fills send/close.
  // A just-created socket refuses send() until open, so early frames (the
  // constructor's join, the first ping) are queued and flushed on open.
  const early = [];
  const conn = {
    send: (t) => { if (ws.readyState === 1) ws.send(t); else early.push(t); },
    close: () => ws.close(),
    onMessage: null,
    onClose: null,
  };
  ws.onopen = () => { for (const t of early) ws.send(t); early.length = 0; };
  ws.onmessage = (e) => conn.onMessage?.(e.data);
  ws.onclose = (e) => conn.onClose?.(e.code, e.reason); // 4000/4001 reach on.turnedAway
  net = createNetClient({
    conn,
    name: ui.name.value.trim() || 'Fahrer',
    now: () => performance.now(), // the client's clock lives in local ms
    every: (ms, fn) => { const h = setInterval(fn, ms); return () => clearInterval(h); },
    on: {
      roster: (players, seed) => { rebuildWorld(seed); onRoster(players); },
      stage: onStage,
      goAt: (g) => { goAt = g; },
      peerPos: ({ id, t, x, z, h, s }) => {
        const r = remotes.get(id) ?? remotes.set(id, { interp: createInterp(), spin: 0 }).get(id);
        r.interp.push({ t, x, z, h, s });
      },
      peerGone: (id) => remotes.delete(id),
      jumped: ({ id, pen }) => jumps.set(id, pen),
      finishInfo: ({ id, t }) => { if (id === selfId) ownT = t; else otherFinishes.push(t); },
      results: showResults,
      turnedAway: (code) => showModal(code === 4000 ? 'Stadt voll — versuch es später wieder.' : 'Rennen läuft schon — versuch es gleich nochmal.'),
      dropped: () => showModal('Verbindung verloren.'),
    },
  });
}

/** The server's seed wins: regenerate city + static mesh synchronously (~1 ms). */
function rebuildWorld(seed) {
  if (seed === null || seed === city.seed) return;
  city = generateCity({ seed });
  window.fairfahren.city = city;
  cityMesh = renderer.upload(buildCityMesh(city));
  life = createLife(city);
  track = null; trackFor = '';
  hud.set('seed', `Seed ${city.seed}`);
}

function onRoster(players) {
  // Our own id: we receive rosters only once OUR join is in (the server
  // subscribes us first), and we sit last in join order in that first one.
  if (selfId === null && players.length) selfId = players[players.length - 1].id;
  ui.roster.innerHTML = players.map((p, i) =>
    `<li><span class="dot" style="background:${cssColor(i)}"></span>${escapeHtml(p.name)}</li>`).join('');
}

/** One seed/player-count step: rebuild the pure track. */
function ensureTrack(n) {
  const want = `${city.seed}/${n}`;
  if (track && trackFor === want) return;
  if (!Number.isInteger(n) || n < 2 || n > 4) return;
  try {
    track = buildTrack(city, n);
    trackFor = want;
  } catch (err) {
    // A seed whose city cannot host the 200 m track means no race — say so on
    // screen (terminated guards the per-frame retries) instead of hiding it.
    console.error('track:', err.message);
    if (!terminated) showModal(`${err.message} — bitte laden Sie die Seite neu.`);
  }
}

/** Per race stage change: grid placement, freeze gate, bookkeeping resets. */
function onStage(s) {
  if (s === 'countdown') {
    remotes.clear(); jumps.clear();
    otherFinishes = []; ownT = null; myFinish = null; prevCross = null; pendingFinish = null;
    results = null; podium = null; gridded = false;
    ui.results.hidden = true;
    ui.againBtn.hidden = true;
    ensureTrack(net.players.length);
    gridSelf();
    gate = createStartGate({
      isGreen: () => net.stage === 'racing' || net.stage === 'finished',
      onJump: () => net.sendRaw(encode('jump', {})), // the gate fires once; server settles
    });
  }
  if (s === 'racing') prevCross = null; // crossing maths starts at green
  if (s === 'ceremony') setPodium();
}

/** Place the local car on our roster-position grid slot, camera snapped. */
function gridSelf() {
  const i = Math.max(0, net.players.findIndex((p) => p.id === selfId));
  const slot = track?.grid[Math.min(i, (track?.grid.length ?? 1) - 1)];
  if (slot) { gridded = true; Object.assign(car, createCar(slot)); camera.snap(); }
}

/**
 * HUD start light (Ampel): lamps follow the shared-clock `light`, the digit
 * counts the seconds to green. Shown through the countdown and 1.5 s past
 * green; CSS does the look and the fade (index.html #startLight).
 */
function updateStartLight(st, light, sNow) {
  const on = !!light && (st === 'countdown' || st === 'racing') && sNow - goAt < 1500;
  ui.light.classList.toggle('on', on);
  if (!light) return;
  ui.light.dataset.light = light;
  hud.set('light', light === 'green' ? 'LOS!' : String(Math.max(1, Math.ceil((goAt - sNow) / 1000))));
}

/** Server-settled results: place, name, official time (+penalty sentence), DNF. */
function showResults(rows) {
  results = rows;
  ui.results.innerHTML = '<table>' + rows.map((r, i) => {
    const t = r.t === null ? 'DNF'
      : `${((r.t - goAt) / 1000).toFixed(2)} s` + (r.pen > 0 ? ` +${(r.pen / 1000).toFixed(1)} s` : '');
    return `<tr><td>${i + 1}.</td><td><span class="dot" style="background:${cssColor(colorIndex(r.id))}"></span>` +
      `${escapeHtml(r.name)}</td><td>${t}</td></tr>`;
  }).join('') + '</table>';
  ui.results.hidden = false;
}

/** Ceremony geometry: podium steps from the pure layout + orbit camera pivot. */
function setPodium() {
  if (!results || !track) return; // guard: a stale ceremony stays crash-free
  const layout = podiumLayout(results, track.start, {
    laneMinZ: track.finish.z0, laneMaxZ: track.finish.z1, roadCenterZ: track.laneZ,
  });
  const steps = new MeshBuilder(), red = rgb(0x7a1f1f);
  for (const s of layout.steps) steps.box(s.x - s.w / 2, 0, s.z - s.d / 2, s.x + s.w / 2, s.h, s.z + s.d / 2, red, { mat: MAT.PAINT });
  const cx = layout.steps.reduce((a, s) => a + s.x, 0) / 3, cz = layout.steps.reduce((a, s) => a + s.z, 0) / 3;
  podium = { layout, mesh: renderer.upload(steps), center: [cx, cz] };
  ui.againBtn.hidden = false;
}

const colorIndex = (id) => Math.max(0, net.players.findIndex((p) => p.id === id));
const nameOf = (id) => net.players.find((p) => p.id === id)?.name ?? '?';
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showModal(msg) {
  terminated = true;
  ui.modalMsg.textContent = msg;
  ui.reloadBtn.hidden = false;
  ui.modal.hidden = false;
  ui.lobby.hidden = true;
}

/** Lobby panel: join form while connecting, roster + start gate once joined. */
function updateLobby() {
  if (terminated) return; // turn-away/dropped modal owns the screen now
  const s = net.stage;
  ui.lobby.hidden = ['countdown', 'racing', 'finished', 'ceremony'].includes(s);
  ui.joinRow.hidden = s !== 'connecting';
  ui.roster.hidden = s === 'connecting';
  ui.startBtn.hidden = s === 'connecting';
  ui.startBtn.disabled = !net.canStart;
  ui.status.textContent = s === 'connecting' ? 'Warte auf Verbindung …'
    : s === 'lobby' ? (net.canStart ? 'Start frei' : 'Warte auf Mitspieler …') : 'Rennen läuft';
}

/** One taxi (local or remote): body, colour skirt, wheels, shadow. */
function drawCar(x, z, h, colorIdx, spin, steer, y = 0) {
  const m = compose(translation(x, y, z), rotationY(h));
  renderer.draw(taxi.body, m);
  if (colorIdx >= 0) renderer.draw(stripeMesh(colorIdx), m);
  for (const w of wheels) {
    renderer.draw(taxi.wheel, compose(m, translation(w.x, w.y, w.z), rotationY(w.front ? steer : 0), rotationX(spin)));
  }
  renderer.draw(taxi.shadow, m, true);
}

/** Thin coloured skirt peeking out under the ivory body, one per player colour. */
function stripeMesh(i) {
  if (!stripes[i]) {
    const b = new MeshBuilder(), c = rgb(COLORS[i]);
    b.box(-0.98, 0.3, -2.42, -0.9, 0.7, 2.42, c, { mat: MAT.PAINT });
    b.box(0.9, 0.3, -2.42, 0.98, 0.7, 2.42, c, { mat: MAT.PAINT });
    stripes[i] = renderer.upload(b);
  }
  return stripes[i];
}

/** Status chip next to the fps: stage word and jump flags (the HUD light counts down). */
function chipText(st) {
  let t = { connecting: 'Verbinde …', lobby: 'Lobby', finished: 'Ziel', ceremony: 'Siegerehrung' }[st];
  if (st === 'racing') t = 'Rennen';
  if (st === 'countdown') t = 'Ampel';
  const pen = [...jumps].map(([id, pen]) => `${nameOf(id)} Ampel! +${(pen / 1000).toFixed(1)} s`).join(' · ');
  return (t ?? '') + (pen ? ` · ${pen}` : '');
}

/** Live position: settled order once results are in, else crossed-before count. */
function posText(st) {
  if (results) {
    const i = results.findIndex((r) => r.id === selfId);
    return i >= 0 ? `P${i + 1}` : '';
  }
  const before = ownT === null ? otherFinishes.length : otherFinishes.filter((t) => t <= ownT).length;
  return st === 'racing' || st === 'finished' ? `P${1 + before}` : '';
}

/** The online loop: the solo renderer, with the race state machine around it. */
function onlineFrame(now, dt) {
  const st = net.stage;
  updateLobby();
  ensureTrack(net.players.length);
  const sNow = net.clock.serverNow(performance.now());
  const light = goAt !== null && sNow !== null ? ampelState(sNow, goAt) : null;

  if (keyboard.consume('KeyC')) camera.next();
  if (keyboard.consume('KeyV')) sensorView.toggle();
  if (keyboard.consume('KeyR')) { // respawn stays: back to our slot once we have one
    if (track && gridded) gridSelf();
    else { Object.assign(car, createCar(city.spawn)); camera.snap(); }
  }

  // Local physics from the grid on, behind the pure freeze gate; through the
  // whole lobby the taxi is parked, hidden and never stepped.
  const input = keyboard.driving();
  if (gate && st !== 'lobby' && st !== 'ceremony') {
    for (accumulator += dt; accumulator >= PHYSICS_STEP; accumulator -= PHYSICS_STEP) {
      gate.step(car, input, TAXI, PHYSICS_STEP);
      collideCar(car, city.colliders, TAXI);
      // ms-precise finish crossing, reported once as master-clock time T.
      // The step's own simulated timestamp: frame clock minus the still-owed
      // accumulator, so batches of 1/120 s steps keep distinct t values.
      if (track && ['racing', 'finished'].includes(st) && myFinish === null) {
        const cur = { x: car.x, t: now - accumulator * 1000 };
        if (prevCross) {
          const cross = crossingTime(prevCross, cur, track.finish.x);
          if (cross !== null) pendingFinish = cross;
        }
        prevCross = cur;
      }
      if (pendingFinish !== null) { // unstuck clock → report as soon as sync arrives
        const sT = net.clock.serverNow(pendingFinish);
        if (sT !== null) { myFinish = pendingFinish; net.sendFinish(sT); pendingFinish = null; }
      }
    }
    if (now - lastPos >= 66) { // stream our state at ~15 Hz
      lastPos = now;
      net.sendPos({ x: car.x, z: car.z, h: car.heading, s: car.speed });
    }
  } else accumulator = 0;

  // Camera: normal rigs while driving, a dedicated orbit over the podium.
  const aspect = renderer.resize();
  let view;
  if (st === 'ceremony' && podium) {
    orbit += dt * 0.35;
    const [cx, cz] = podium.center;
    const eye = [cx + Math.cos(orbit) * 14, 6, cz + Math.sin(orbit) * 14];
    view = { proj: perspective(1.0, aspect, 0.5, 1500), view: lookAt(eye, [cx, 0.6, cz]), eye };
  } else {
    camera.update(car, dt);
    view = camera.matrices(aspect);
  }

  renderer.beginFrame(view, ENV);
  renderer.draw(cityMesh);
  drawLife(dt, gridded && st !== 'lobby' && st !== 'ceremony');

  for (const [id, r] of remotes) { // ghosts run ~100 ms behind the render clock
    const s = r.interp.sample(now);
    if (s) {
      r.spin = (r.spin + s.s * dt / TAXI.wheelRadius) % (Math.PI * 2);
      drawCar(s.x, s.z, s.h, colorIndex(id), r.spin, 0);
    }
  }
  if (gridded && st !== 'lobby' && st !== 'ceremony') {
    drawCar(car.x, car.z, car.heading, colorIndex(selfId), car.wheelSpin, car.steer);
  }
  if (st === 'ceremony' && podium) {
    renderer.draw(podium.mesh);
    for (const c of podium.layout.cars) {
      const y = c.place ? podium.layout.steps[c.place - 1].h : 0;
      drawCar(c.x, c.z, c.heading, colorIndex(c.id), 0, 0, y);
    }
  }

  hud.set('speed', String(Math.round(Math.abs(car.speed) * 3.6)));
  hud.set('street', streetAt(city, car.x, car.z));
  hud.set('net', chipText(st));
  updateStartLight(st, light, sNow);
  hud.set('pos', posText(st));
}

// ---------------------------------------------------------------------------
// The shared frame loop
// ---------------------------------------------------------------------------
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  ENV.time += dt;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  try {
    step(now, dt);
  } catch (err) { // one visible crash line instead of a silently dead loop
    console.error(err);
    document.querySelector('#error').textContent = err.message;
    throw err;
  }
  hud.set('fps', `${Math.round(fps)} fps · ${camera.modeName} cam`);
  // Sensors run every frame (they remember the speed limit); drawing only when the panel is shown.
  const sensed = senseEnvironment(car, city, sensorState);
  if (sensorView.visible) sensorView.draw(sensed, car, dt);
  keyboard.endFrame();
  requestAnimationFrame(frame);
}

function step(now, dt) {
  if (net) {
    onlineFrame(now, dt);
  } else if (ONLINE) {
    // Pre-join lobby: the world stands still, nothing is driven or drawn.
    camera.update(car, dt);
    renderer.beginFrame(camera.matrices(renderer.resize()), ENV);
    renderer.draw(cityMesh);
    drawLife(dt, false);
  } else {
    // Solo: the pre-multiplayer behaviour, plus street life.
    if (keyboard.consume('KeyR')) {
      Object.assign(car, createCar(city.spawn));
      camera.snap();
    }
    if (keyboard.consume('KeyC')) camera.next();
    const input = keyboard.driving();
    for (accumulator += dt; accumulator >= PHYSICS_STEP; accumulator -= PHYSICS_STEP) {
      stepCar(car, input, TAXI, PHYSICS_STEP);
      collideCar(car, city.colliders, TAXI);
    }
    camera.update(car, dt);
    renderer.beginFrame(camera.matrices(renderer.resize()), ENV);
    renderer.draw(cityMesh);
    drawLife(dt, true);
    drawCar(car.x, car.z, car.heading, -1, car.wheelSpin, car.steer);
    hud.set('speed', String(Math.round(Math.abs(car.speed) * 3.6)));
    hud.set('street', streetAt(city, car.x, car.z));
  }
}

requestAnimationFrame(frame);

function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
}
