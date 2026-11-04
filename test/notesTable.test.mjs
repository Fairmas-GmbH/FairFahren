// Keeps the protocol table embedded in NOTES.md in sync with the definitions
// in server/protocol.js (regenerate with: node tools/protocol-table.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { protocolTable } from '../server/protocol.js';

test('NOTES.md carries the generated protocol table, unedited', () => {
  const notes = readFileSync(fileURLToPath(new URL('../NOTES.md', import.meta.url)), 'utf8');
  const embedded = notes.split('<!-- protocol-table:start -->')[1]?.split('<!-- protocol-table:end -->')[0]?.trim();
  assert.ok(embedded && embedded.length > 50, 'table markers missing in NOTES.md');
  assert.equal(embedded, protocolTable().trim());
});
