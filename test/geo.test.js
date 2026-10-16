import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateLabel, parseCoordinates } from '../src/geo.js';

test('coordinates read with hemispheres', () => {
  assert.equal(coordinateLabel(31.558, 74.35), '31.56°N, 74.35°E');
  assert.equal(coordinateLabel(-33.87, -70.65), '33.87°S, 70.65°W');
});

test('typed coordinates are understood, in either form', () => {
  assert.deepEqual(parseCoordinates('31.56, 74.35'), { latitude: 31.56, longitude: 74.35 });
  assert.deepEqual(parseCoordinates('-33.9 18.4'), { latitude: -33.9, longitude: 18.4 });
  assert.deepEqual(parseCoordinates('33.9 S, 18.4 E'), { latitude: -33.9, longitude: 18.4 });
  assert.deepEqual(parseCoordinates('51.5°n; 0.13°w'), { latitude: 51.5, longitude: -0.13 });
  // the label the page writes into the search box reads back as the same spot, so shared links work
  assert.deepEqual(parseCoordinates(coordinateLabel(-12.05, -77.04)), { latitude: -12.05, longitude: -77.04 });
});

test('anything else is a place name, not coordinates', () => {
  for (const text of ['Lahore', '10 Downing Street', '91, 10', '10, 181', '', null, '31.5']) {
    assert.equal(parseCoordinates(text), null, `${text} should not parse`);
  }
});
