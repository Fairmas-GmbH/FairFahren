// Enforces the size budget of the shipped game (index.html + src/**).
// Usage: node tools/size-check.mjs     Exit code 1 when over budget.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

// The base game uses ~116 KB raw / ~41 KB gzip. The headroom is for candidates' features.
export const BUDGET = { raw: 160 * 1024, gzip: 52 * 1024 };

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const files = [join(ROOT, 'index.html'), ...walk(join(ROOT, 'src'))];
const all = Buffer.concat(files.map((f) => readFileSync(f)));
const raw = all.length, gzip = gzipSync(all, { level: 9 }).length;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const f of files) console.log(`${kb(statSync(f).size).padStart(9)}  ${relative(ROOT, f).replaceAll('\\', '/')}`);
console.log('-'.repeat(40));
console.log(`${kb(raw).padStart(9)}  total raw   (budget ${kb(BUDGET.raw)})`);
console.log(`${kb(gzip).padStart(9)}  total gzip  (budget ${kb(BUDGET.gzip)})`);

if (raw > BUDGET.raw || gzip > BUDGET.gzip) {
  console.error('\nSize budget exceeded. Generate it, don\'t ship it.');
  process.exit(1);
}
console.log('\nWithin budget.');
