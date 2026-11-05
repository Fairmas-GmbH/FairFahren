# FairFahren 🚕

A tiny procedural 3D driving game: steer a German taxi through a generated slice of Berlin.
**~116 KB of plain JavaScript (~41 KB gzipped). No assets. No dependencies. No build step.** Every street, building, tree and landmark comes from one seed.

Built as the base project for developer interviews: candidates extend it (see [the candidate brief](docs/04-candidate-brief.md)).

## Quick start

Requires Node 22+ and a browser with WebGL2.

```bash
npm start
```

Open <http://localhost:8080>. Add `?seed=42` for a different city.

| Key | Action |
|---|---|
| W / ↑ | accelerate |
| S / ↓ | brake, then reverse |
| A / ← · D / → | steer |
| Space | handbrake |
| C | camera: chase → bonnet → overhead |
| V | sensor view on/off |
| R | reset to spawn |

## What's in the city

Berlin street grid with real street names · *Altbau* perimeter blocks with courtyards, shop fronts and vacant lots · *Plattenbau* slabs (more in the east) · parks · the Spree with bridges and *Ufer* streets · *Unter den Linden* with a linden-tree median · a city gate you can drive through · a TV tower on a plaza · German traffic signs (speed limits 30/50, priority road, yield).

## Sensor view

The panel at the bottom right shows the city the way the taxi's driver-assistance sensors perceive it, like the display in a Tesla. It shows road edges, lane markings, lidar returns, park-sensor distances, radar distance to the obstacle ahead, recognised traffic signs and the active speed limit, plus a collision warning. Press **V** to hide or show it.

## Checks

```bash
npm test
```

```bash
npm run size
```

`npm run check` runs both. The size budget (160 KB raw / 52 KB gzip for `index.html` + `src/`) is enforced.

## Project layout

```
index.html            page, HUD, loads src/main.js
src/main.js           wiring + fixed-timestep game loop
src/core/             seeded RNG, math (matrices)
src/gfx/              mesh builder, shaders, WebGL2 renderer
src/world/            city generator (pure data) + city mesh
src/vehicle/          taxi physics, collision, taxi model
src/game/             input, camera, HUD
test/                 node --test unit tests
tools/                dev server, size check
docs/                 requirements, spec, setup, candidate brief, ADRs
```

## Documentation

1. [Requirements](docs/01-requirements.md)
2. [Technical specification](docs/02-technical-specification.md)
3. [Prerequisites & setup](docs/03-prerequisites.md)
4. [Candidate brief](docs/04-candidate-brief.md)
5. Architecture decisions: [raw WebGL2](docs/adr/0001-raw-webgl2-no-engine.md) · [seeded generation](docs/adr/0002-seeded-procedural-generation.md) · [size budget](docs/adr/0003-size-budget.md)
