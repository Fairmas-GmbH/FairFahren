# 03 — Prerequisites & setup

## Required

| Tool | Version | Why |
|---|---|---|
| A browser with **WebGL2** | Current Chrome, Edge, Firefox or Safari | Runs the game. Check at <https://get.webgl.org/webgl2/>. |
| **Node.js** | 22 LTS or newer | Dev server, unit tests (`node --test`), size check. No `npm install` needed — there are no dependencies. |
| Git | any | To receive and hand in the task. |

Recommended: VS Code (or any editor) with ESLint/Prettier if you like — not required, and not part of the project.

## Run

```bash
npm start
```

Then open <http://localhost:8080>. Another port: `node tools/serve.mjs 3000`.

ES modules do not load from `file://`, so opening `index.html` directly will not work — always use the dev server (or any static server, e.g. `python -m http.server`).

## Check

```bash
npm test
```

```bash
npm run size
```

`npm run check` runs both. Both must pass before you hand in.

## Debugging tips

- `window.fairfahren` in the browser console gives you `city`, `car`, `camera` and the `TAXI` tuning. Example: `fairfahren.car.speed = 30` or `fairfahren.TAXI.maxSpeed = 60`.
- `?seed=42` in the URL generates a different city.
- Shader compile errors are thrown with the GLSL log — look in the console.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Black page, "WebGL2 is not available" | Enable hardware acceleration in the browser settings, or try another browser. |
| Blank page, module errors in the console | You opened the file via `file://`. Use `npm start`. |
| `node --test` finds no tests | Node too old. Use Node 22+. |
| Low FPS on a 4K screen | The renderer caps the device pixel ratio at 2; try a smaller window. |
