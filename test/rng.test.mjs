import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hashString } from '../src/core/rng.js';

test('same seed gives the same sequence', () => {
  const a = new Rng(42), b = new Rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('different seeds give different sequences', () => {
  assert.notEqual(new Rng(1).next(), new Rng(2).next());
});

test('values stay in range', () => {
  const r = new Rng(7);
  for (let i = 0; i < 10000; i++) {
    const f = r.next();
    assert.ok(f >= 0 && f < 1);
    const n = r.int(3, 5);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 5);
  }
});

test('forks are independent of how much the parent was used', () => {
  const a = new Rng(99), b = new Rng(99);
  b.next(); b.next();
  assert.equal(a.fork('trees').next(), b.fork('trees').next());
  assert.notEqual(a.fork('trees').next(), a.fork('houses').next());
});

test('hashString is stable', () => {
  assert.equal(hashString('berlin'), hashString('berlin'));
  assert.notEqual(hashString('berlin'), hashString('Berlin'));
});
