// Static file serving, shared by the dev server (tools/serve.mjs) and the game
// server (server/main.mjs) — one implementation, no copy-paste. Extracted from
// tools/serve.mjs; the try/catch around path parsing is new: a malformed URL
// (e.g. "/%") must answer 400, not crash the process with an unhandled throw.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8' };

// Returns an http request listener that serves files from `root` on disk.
export function serveStatic(root) {
  return async (req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return res.writeHead(400).end();
    }
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root + sep)) return res.writeHead(403).end(); // path traversal
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  };
}
