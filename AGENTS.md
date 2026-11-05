# AGENTS.md — FairFahren

Rules for AI coding agents working in this repo.

## What this project is

A procedural 3D driving game (steer a German taxi through a generated slice of
Berlin) built as a base project for developer interviews. Candidates extend it.

- **~123 KB of plain JavaScript. No assets, no dependencies, no build step.**
- Everything is generated from one seed (`?seed=42` gives the same city to everyone).
- Requires Node 22+ and a browser with WebGL2.

## Hard constraints (never break these)

1. **Zero dependencies** — nothing goes in `package.json` dependencies, no `node_modules`.
2. **Raw WebGL2, no engine** — no three.js/Babylon or any 3D library (ADR 0001).
3. **No asset files** — all content is generated from a seed; surface detail comes
   from the fragment shader. `Math.random()` is banned for world content — use the
   seeded RNG (`src/core/rng.js`) with **forked streams** (`rng.fork('…')`) so one
   feature doesn't reshuffle the rest of the world.
4. **Size budget is enforced** — `npm run size` fails above **160 KB raw / 52 KB gzip**
   for `index.html` + `src/**`. Source ships unminified and readable; every byte counts.
5. **Generation is plain data** — `generateCity` produces data that is separately
   turned into geometry (`buildCityMesh`) and colliders, so it stays testable in Node.

## Commands

```bash
npm start        # dev server on http://localhost:8080
npm test         # node --test unit tests
npm run size     # size budget check
npm run check    # tests + size check — run this before considering work done
```

## Layout

```
index.html            page, HUD, loads src/main.js
src/main.js           wiring + fixed-timestep game loop
src/core/             seeded RNG, math (matrices)
src/gfx/              mesh builder, shaders, WebGL2 renderer
src/world/            city generator (pure data) + city mesh
src/vehicle/          taxi physics, collision, taxi model
src/game/             input, camera, HUD
test/                 unit tests (node:test, *.test.mjs)
tools/                dev server, size check
docs/                 requirements, spec, candidate brief, ADRs
```

Details live in `docs/01`–`04` and `docs/adr/`. Read them when a task touches
requirements, rendering, generation, or the size budget.

## Workflow rules

**Traceability:** all plans, working documents, and design decisions are saved
in a dedicated folder inside `docs/` (e.g. `docs/plans/`), never just in chat.
Plans go there automatically; anything else (notes, lists, stray docs) goes
there only after asking the user first.

- **Speed over ceremony.** Ship the smallest working change fast — no red/green
  TDD, no test-first gates. Run `npm run check` before considering work done;
  never ship with it failing.
- **Deploy review agents if needed.** For large, risky, or constraint-touching
  changes, spin up review agent(s) to check the diff before calling the work done.
- Tests run in Node with `node:test` — keep game logic (world gen, physics, RNG)
  pure and browser-free so it stays testable.
- Match the existing style: ES modules, plain functions over classes, small
  commented code.
- Don't commit, push, or rewrite history unless explicitly asked.

## Communication

- When the user asks questions, answer **"for dummies" style**: plain language,
  short sentences, everyday analogies, no jargon without a one-line explanation.
