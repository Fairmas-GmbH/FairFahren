/**
 * "What the car sees": top-down driver-assistance display of the data from
 * senseEnvironment(), drawn on a 2D canvas in the HUD. Car-up view that zooms
 * in when slow (parking) and out when fast.
 */
const COL = {
  bg: '#0b1016', ring: 'rgba(255,255,255,0.06)', header: 'rgba(255,255,255,0.05)',
  edge: 'rgba(120,135,155,0.28)', edgeLine: 'rgba(170,185,205,0.75)', river: 'rgba(60,120,190,0.35)',
  lane: 'rgba(235,240,245,0.85)', lidar: '#3fd2ff', tree: 'rgba(110,170,110,0.7)', radar: '#9fb4ff',
  ego: '#e8dcb0', text: '#e8edf2', dim: 'rgba(232,237,242,0.45)', ok: '#46d36b', warn: '#f2c230', alert: '#ff4d4d',
};
const zoneColor = (d) => (d < 0.6 ? COL.alert : d < 1.2 ? COL.warn : COL.ok);

export class SensorView {
  constructor(panel) {
    this.panel = panel;
    this.canvas = panel.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.zoom = 30; // metres visible vertically
  }

  get visible() {
    return !this.panel.hidden;
  }

  toggle() {
    this.panel.hidden = !this.panel.hidden;
  }

  draw(view, car, dt) {
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const speed = Math.abs(car.speed);
    this.zoom += (24 + Math.min(speed, 20) * 2.8 - this.zoom) * Math.min(1, dt * 2);
    const s = H / this.zoom, cx = W / 2, cy = H * 0.7;
    const X = (p) => cx + p[0] * s, Y = (p) => cy - p[1] * s;
    const path = (pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    };

    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = COL.ring;
    for (let r = 10; r < this.zoom; r += 10) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * s, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Road edges: curbs, medians, river, gate pillars.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COL.edgeLine;
    for (const e of view.edges) {
      path(e.pts);
      ctx.closePath();
      ctx.fillStyle = e.tag === 'river' ? COL.river : COL.edge;
      ctx.fill();
      ctx.stroke();
    }

    // Lane markings.
    ctx.strokeStyle = COL.lane;
    ctx.lineWidth = Math.max(1.5, 0.16 * s);
    ctx.beginPath();
    for (const [a, b] of view.markings) {
      ctx.moveTo(X(a), Y(a));
      ctx.lineTo(X(b), Y(b));
    }
    ctx.stroke();

    // Detected objects (trees) and lidar returns.
    ctx.fillStyle = COL.tree;
    for (const o of view.objects) {
      ctx.beginPath();
      ctx.arc(X(o), Y(o), Math.max(2, 0.6 * s), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = COL.lidar;
    for (const p of view.lidar) ctx.fillRect(X(p) - 1.5, Y(p) - 1.5, 3, 3);

    for (const sg of view.signs) drawSign(ctx, sg.type, sg.value, X([sg.lx, sg.lz]), Y([sg.lx, sg.lz]), 7);

    // Forward radar: distance to the nearest obstacle in the car's path.
    const f = view.front, warn = f.ttc < 1.6;
    if (f.d < this.zoom) {
      const y = Y([0, 2.5 + f.d]);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = warn ? COL.alert : COL.radar;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, Y([0, 2.5]));
      ctx.lineTo(cx, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (f.d >= 2.5) label(ctx, `${f.d.toFixed(1)} m`, cx + 6, y + 12, warn ? COL.alert : COL.radar, 'left'); // closer: park sensors take over
    }

    // Ego car with its roof sign.
    ctx.fillStyle = COL.ego;
    path([[-0.92, -2.45], [0.92, -2.45], [0.92, 2.45], [-0.92, 2.45]]);
    ctx.fill();
    ctx.fillStyle = '#f5c400';
    path([[-0.3, -0.5], [0.3, -0.5], [0.3, -0.25], [-0.3, -0.25]]);
    ctx.fill();

    // Park sensors: a short bar where each beam hits, coloured by distance.
    let nearest = null;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const u of view.ultrasonic) {
      if (!(u.d < 2.5)) continue;
      if (!nearest || u.d < nearest.d) nearest = u;
      const px = Math.cos(u.a) * 0.35, pz = -Math.sin(u.a) * 0.35; // perpendicular to the beam
      ctx.strokeStyle = zoneColor(u.d);
      path([[u.hit[0] + px, u.hit[1] + pz], [u.hit[0] - px, u.hit[1] - pz]]);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    if (nearest) {
      // Label just beyond the closest hit, on the far side from the car.
      const [hx, hz] = nearest.hit, k = 1 + 6 / (s * Math.hypot(hx, hz));
      label(ctx, `${nearest.d.toFixed(1)} m`, X([hx * k, hz * k]), Y([hx * k, hz * k]) + 4, zoneColor(nearest.d), 'center');
    }

    // Header: recognised signs, active speed limit and current speed.
    ctx.fillStyle = COL.header;
    ctx.fillRect(0, 0, W, 34);
    view.signs.slice(0, 3).forEach((sg, i) => {
      drawSign(ctx, sg.type, sg.value, 18 + i * 52, 17, 11);
      label(ctx, `${Math.round(sg.d)} m`, 33 + i * 52, 21, COL.dim, 'left', '600 10px');
    });
    if (view.speedLimit) {
      const kmh = Math.round(speed * 3.6);
      drawSign(ctx, 'limit', view.speedLimit, W - 20, 17, 13);
      label(ctx, `${kmh} km/h`, W - 40, 22, kmh > view.speedLimit + 3 ? COL.alert : COL.text, 'right');
    }

    if (warn) {
      ctx.fillStyle = COL.alert;
      ctx.fillRect(0, H - 28, W, 28);
      label(ctx, '⚠ COLLISION WARNING', cx, H - 9, '#fff', 'center', 'bold 13px');
    } else {
      label(ctx, 'SENSOR VIEW', 8, H - 8, COL.dim, 'left', '600 10px');
    }
  }
}

function label(ctx, text, x, y, color, align, font = '600 12px') {
  ctx.font = `${font} system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

/** German traffic signs as small canvas icons. */
function drawSign(ctx, type, value, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  if (type === 'limit') {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.24;
    ctx.strokeStyle = '#c8302c';
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = `bold ${Math.round(r * 0.95)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, 0, r * 0.06);
  } else if (type === 'priority') {
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(-r * 0.5, -r * 0.5, r, r);
  } else {
    ctx.moveTo(0, r * 0.8);
    ctx.lineTo(-r, -r * 0.8);
    ctx.lineTo(r, -r * 0.8);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = r * 0.25;
    ctx.strokeStyle = '#c8302c';
    ctx.stroke();
  }
  ctx.restore();
}
