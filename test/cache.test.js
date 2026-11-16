import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache, retryDelay, FRESH_FOR, KEEP_FOR } from '../src/cache.js';

function memoryStorage({ quota = Infinity } = {}) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (v.length > quota) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
    raw: data,
  };
}

test('an answer is fresh for ten minutes, then kept as a fallback until it expires', () => {
  let t = 1_000_000;
  const cache = createCache(memoryStorage(), () => t);
  cache.put('u', { temp: 21 });
  assert.deepEqual(cache.get('u'), { body: { temp: 21 }, at: 1_000_000, fresh: true });
  t += FRESH_FOR;
  assert.equal(cache.get('u').fresh, false);
  t = 1_000_000 + KEEP_FOR;
  assert.equal(cache.get('u'), null);
});

test('unknown urls, damaged storage and no storage all read as a miss', () => {
  const storage = memoryStorage();
  assert.equal(createCache(storage).get('nope'), null);
  storage.setItem('weather:answers:v1', '{not json');
  assert.equal(createCache(storage).get('u'), null);
  storage.setItem('weather:answers:v1', JSON.stringify({ u: { at: 'yesterday', body: 1 } }));
  assert.equal(createCache(storage).get('u'), null);
  const none = createCache(null);
  none.put('u', 1);
  assert.equal(none.get('u'), null);
});

test('a clock set backwards does not make an old answer look new', () => {
  let t = 5_000_000;
  const cache = createCache(memoryStorage(), () => t);
  cache.put('u', 1);
  t -= 60_000;
  assert.equal(cache.get('u'), null);
});

test('keeps the six newest answers', () => {
  let t = 0;
  const storage = memoryStorage();
  const cache = createCache(storage, () => t);
  for (let i = 0; i < 8; i++) { t += 1000; cache.put(`u${i}`, i); }
  assert.equal(cache.get('u0'), null);
  assert.equal(cache.get('u1'), null);
  assert.equal(cache.get('u7').body, 7);
  assert.equal(Object.keys(JSON.parse(storage.getItem('weather:answers:v1'))).length, 6);
});

test('when storage is full, the oldest answers go first and saving never throws', () => {
  let t = 0;
  const storage = memoryStorage({ quota: 120 });
  const cache = createCache(storage, () => t);
  t = 1; cache.put('a', 'x'.repeat(40));
  t = 2; cache.put('b', 'y'.repeat(40));
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b').body.length, 40);
  t = 3;
  assert.doesNotThrow(() => cache.put('huge', 'z'.repeat(500)));
  assert.equal(cache.get('huge'), null);
});

test('retry waits: backoff by default, the server Retry-After when readable, none past the cap', () => {
  assert.equal(retryDelay(null, 0), 600);
  assert.equal(retryDelay(undefined, 1), 1200);
  assert.equal(retryDelay('2', 0), 2000);
  assert.equal(retryDelay('0', 3), 0);
  assert.equal(retryDelay('60', 0), null);
  assert.equal(retryDelay(new Date(10_000 + 3000).toUTCString(), 0, { now: 10_000 }), 3000);
  assert.equal(retryDelay('soon', 0), 600);
  assert.equal(retryDelay(null, 3), null);
});
