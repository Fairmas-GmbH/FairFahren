// Zero-dependency static file server for local development (solo mode).
// Usage: node tools/serve.mjs [port]   (default 8080)
// The serving logic itself lives in server/static.mjs, shared with the game server.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../server/static.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);

createServer(serveStatic(ROOT)).listen(PORT, () => console.log(`FairFahren running at http://localhost:${PORT}`));
