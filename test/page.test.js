import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';

test('the page has a strict Content-Security-Policy', () => {
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "script-src-attr 'none'"]) assert.ok(csp.includes(d), d);
  const script = csp.split(';').find((d) => d.trim().startsWith('script-src ')) ?? '';
  assert.ok(!/unsafe-inline|unsafe-eval/.test(script), 'no inline or eval scripts');
});

test('the only inline script is the import map, allowed by its hash', () => {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1);
  assert.match(inline[0][1], /type="importmap"/);
  const hash = createHash('sha256').update(inline[0][2]).digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`), 'CSP names the import map hash');
});

test('every host the code fetches from is in connect-src', () => {
  const src = ['app.js', 'weather.js', 'globe.js', 'streets.js'].map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('\n');
  const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src ')) ?? '';
  for (const host of ['api.open-meteo.com', 'geocoding-api.open-meteo.com', 'air-quality-api.open-meteo.com', 'nominatim.openstreetmap.org']) {
    assert.ok(src.includes(host), `${host} is used`);
    assert.ok(connect.includes(`https://${host}`), `${host} is allowed`);
  }
});
