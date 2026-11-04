# 02 — Technical specification

## 1. Architecture overview

```
                 seed (4 bytes)
                      │
                      ▼
   ┌──────────── world/cityGen.js ─────────────┐   pure data, runs in Node
   │ streets, blocks, buildings, river,        │
   │ trees, landmarks, markings, colliders     │
   └───────┬───────────────────────┬───────────┘
           │                       │
           ▼                       ▼
   world/cityMesh.js        vehicle/collision.js ◄── vehicle/carPhysics.js ◄── game/input.js
   (data → triangles)              │                        │
           │                       └──────────┬─────────────┘
           ▼                                  ▼
   gfx/meshBuilder.js ──► gfx/renderer.js ◄── game/camera.js
                               │
                         gfx/shaders.js  (procedural surface detail)
```

Rule of the codebase: **data in, data out.** Generation and simulation never touch the DOM or WebGL; rendering never decides game logic. `main.js` is the only place that wires everything together.

## 2. Module reference

| File | Responsibility | Pure? |
|---|---|---|
| `src/main.js` | Bootstraps everything, fixed-timestep game loop, HUD updates. | no |
| `src/core/rng.js` | Seeded PRNG (mulberry32), string hashing, forkable streams. | yes |
| `src/core/math.js` | `clamp/lerp/damp/approach`, 4×4 matrices (column-major). | yes |
| `src/gfx/meshBuilder.js` | CPU-side geometry: `poly`, `rect`, `box`, `frustum`, `cylinderX`, `sphere`. Auto-orients faces. | yes |
| `src/gfx/shaders.js` | One GLSL ES 3.0 program; procedural windows, water, asphalt, soft shadow. | – |
| `src/gfx/renderer.js` | WebGL2 context, mesh upload (VAO), per-frame uniforms, draw calls. | no |
| `src/world/cityGen.js` | Procedural city as plain data + `streetAt()` lookup. | yes |
| `src/world/cityMesh.js` | Converts city data into one static mesh. | yes |
| `src/vehicle/carPhysics.js` | `TAXI` tuning, `createCar`, `stepCar` (bicycle model). | yes |
| `src/vehicle/collision.js` | `pushOut` (circle vs boxes/circles), `collideCar` (response). | yes |
| `src/vehicle/taxiModel.js` | Taxi body, wheel and shadow meshes; wheel positions. | yes |
| `src/game/input.js` | Keyboard state, edge-triggered presses, driving input mapping. | no |
| `src/game/camera.js` | Chase / bonnet / overhead rigs with smoothing. | yes* |
| `src/game/hud.js` | Writes HUD text only when it changes. | no |

\* no DOM, but only used by the browser.

## 3. Conventions

- **Coordinates:** Y up, **X east, Z south**, metres. Heading 0 faces +Z; forward = `(sin h, 0, cos h)`; positive heading/steer = left turn.
- **Matrices:** column-major `Float32Array(16)`, `compose(a, b, c) = a·b·c`.
- **Colors:** data stores `0xRRGGBB` ints; mesh code converts with `rgb()`.
- **Randomness:** only via `Rng`. Every feature uses its own `rng.fork('label')`; every block uses `fork('block:x,z')`. Adding random calls in one feature therefore does **not** change the rest of the city.

## 4. City generation (`generateCity(options)`)

Config defaults (`DEFAULT_CITY`): 8×7 blocks of 70–105 m, streets 14 m, boulevard 36 m with an 8 m median, river 46 m, sidewalks 4 m, curb 0.15 m.

Steps:

1. **Special rows.** Pick the river row (southern half) and the boulevard street (north of the river).
2. **Axis layout.** Alternate streets and blocks along X and Z (`layoutAxis`), centred on the origin. The river row has a fixed width; the boulevard is wider.
3. **Names.** Shuffle pools of real Berlin street names; boulevard = *Unter den Linden*, river banks get *-ufer/-damm* names.
4. **River & bridges.** Each N–S street crosses the Spree with probability 0.6; two streets always do.
5. **Landmarks.** City gate mid-block on the boulevard in column 1 (six pillar pairs, five drivable passages). TV tower on a plaza block east of centre.
6. **Blocks.** Kind per block: plaza (fixed), park (*Tiergarten* next to the gate, else 10 %), *Plattenbau* (18 % rising to 53 % in the east), else *Altbau*.
   - *Altbau:* perimeter rows of 12–16 m depth around a courtyard, split into 12–22 m parcels (no slivers < 10 m), 4–6 floors × 3.6 m, 75 % gable roofs, 6 % vacant lots, 0–2 courtyard trees.
   - *Plattenbau:* 1–2 slabs, 12 m deep, along the longer block side, 8–11 floors × 2.8 m, trees on the lawn.
   - *Park:* trees scattered with 6 m minimum spacing (≈ 1 per 220 m²).
7. **Median** with linden trees every 11 m, gaps at crossings and ±14 m around the gate.
8. **Markings** as line segments (dashed by the mesh builder): centre lines; two lane dividers on the boulevard.
9. **Forest** ring around the city (260 attempts).
10. **Colliders** (`{type:'box'|'circle', …, tag}`): every block (curb), medians, gate pillar walls, river segments between bridges, four border walls.
11. **Spawn**: right-hand lane of the boulevard, 30 m east of the gate, heading east.

Output shape (abridged):

```js
{ seed, config, bounds:{x0,z0,x1,z1},
  streetsNS:[{center,width,kind,name}], streetsEW:[…],
  river:{name,z0,z1,bridges:[{street,x0,x1}]},
  blocks:[{ix,iz,x0,z0,x1,z1,kind,ground,buildings:[{kind,x0,z0,x1,z1,y0,height,color,roof,roofColor,roofHeight,ridgeAlongX}]}],
  medians, markings:[{x0,z0,x1,z1}], trees:[{x,y,z,s}],
  landmarks:[{kind:'gate',x,z,width,pillars}, {kind:'tvTower',x,y,z}],
  colliders:[…], spawn:{x,z,heading} }
```

## 5. Rendering

- **WebGL2**, one shader program. Vertex format: position(3) normal(3) color(3) material(1) = 40 bytes.
- **Flat shading**: every face has its own vertices and normal → low-poly look, no smoothing groups.
- **Face orientation**: `MeshBuilder.poly()` computes the normal with Newell's method and flips it (and the winding) away from a given interior point, so back-face culling just works.
- **Materials** (`MAT`): `PLAIN`, `ALTBAU`, `PLATTE` (window grids from world position, shop fronts on the ground floor, panel joints), `WATER` (animated normal + specular), `ASPHALT` (grain), `PAINT` (specular), `SHADOW` (radial alpha from uv in the color slot).
- **Lighting**: Lambert sun + hemispheric sky/ground ambient + Blinn-Phong for glossy materials + fake ambient occlusion at wall bases + exp² distance fog that hides the world edge.
- **Draw calls per frame**: city (1), taxi body (1), wheels (4), shadow (1, blended).
- Typical city (seed 1989): ~450 buildings, ~520 trees → ~87 k vertices / ~40 k triangles (≈ 3.5 MB GPU memory). Data generation ≈ 3 ms, mesh building ≈ 20 ms (Node, laptop).

## 6. Vehicle physics (`stepCar`)

Kinematic bicycle model, fixed step 1/120 s:

- Steering approaches `input.steer × limit` at `steerRate`. The limit is grip-based: `min(maxSteer, atan(maxLateralAccel·L / v²))`.
- Longitudinal: throttle accelerates (fading to 0 at `maxSpeed`) or brakes when rolling backwards; brake pedal brakes, then reverses up to `maxReverse`.
- Resistances: rolling + quadratic air drag (+ handbrake); never flip the direction of travel.
- Yaw rate `v / L · tan(δ)` (× 1.4 with handbrake), then integrate position and wheel spin.

## 7. Collision (`collideCar`)

- Car = two circles (r 0.95 m) at ±1.45 m along the car axis.
- `pushOut` resolves the circle against all colliders one after the other (closest-point test for boxes, nearest-side exit if the centre is inside).
- Response: reflect the velocity component along the contact normal with restitution 0.25, project back onto the car axis. Returns the impact speed (unused in the MVP — hook for damage/sound).
- Broad phase: none (≈ 75 colliders, cheap bounding-box reject first). A spatial grid is a natural extension.

## 8. Size budget enforcement

`tools/size-check.mjs` concatenates `index.html` and every file in `src/`, measures raw and gzip-9 size, prints a per-file table and fails above **96 KB raw / 32 KB gzip**. `npm run check` = tests + size. Tests, docs and tools are not shipped and do not count.

## 9. Testing

`node --test` (built in, no dependencies). Covered: RNG determinism and ranges; city determinism, world invariants for several seeds (buildings within blocks, no blocks in the river, ≥ 2 bridges, exactly one of each landmark, collision-free spawn on *Unter den Linden*); physics (acceleration, top speed, braking/reversing, coasting to a stop, steering direction, wall collision, bounce).

Rendering is verified manually; `window.fairfahren` exposes `{ city, car, camera, TAXI }` for console inspection.
