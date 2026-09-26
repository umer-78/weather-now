import test from 'node:test';
import assert from 'node:assert/strict';
import { toSphere, fromSphere, facing, coordinateLabel } from '../src/geo.js';

const PLACES = [[31.56, 74.35], [51.51, -0.13], [-33.87, 151.21], [40.71, -74.01], [0, 0], [-54.8, -68.3], [64.14, -21.94], [0, 179.9], [0, -179.9]];

test('a click on the globe maps back to the same latitude and longitude', () => {
  for (const [lat, lon] of PLACES) {
    const back = fromSphere(toSphere(lat, lon, 1.7));
    assert.ok(Math.abs(back.lat - lat) < 1e-9 && Math.abs(back.lon - lon) < 1e-9, `${lat}, ${lon} came back as ${back.lat}, ${back.lon}`);
  }
});

test('the map texture lines up: longitude 0 on +x, the north pole on +y', () => {
  const greenwich = toSphere(0, 0);
  assert.ok(Math.abs(greenwich.x - 1) < 1e-12 && Math.abs(greenwich.z) < 1e-12);
  assert.ok(Math.abs(toSphere(90, 0).y - 1) < 1e-12);
});

test('turning the globe brings the place to face the camera', () => {
  // three.js Euler 'XYZ' applied to a point: spin about y, then tilt about x.
  const turn = ({ x, y, z }, a, b) => {
    const spun = { x: x * Math.cos(b) + z * Math.sin(b), y, z: -x * Math.sin(b) + z * Math.cos(b) };
    return { x: spun.x, y: spun.y * Math.cos(a) - spun.z * Math.sin(a), z: spun.y * Math.sin(a) + spun.z * Math.cos(a) };
  };
  for (const [lat, lon] of PLACES) {
    const { x, y } = facing(lat, lon);
    const p = turn(toSphere(lat, lon), x, y);
    assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9 && Math.abs(p.z - 1) < 1e-9, `${lat}, ${lon} ended at ${JSON.stringify(p)}`);
  }
});

test('coordinates read with hemispheres', () => {
  assert.equal(coordinateLabel(31.558, 74.35), '31.56°N, 74.35°E');
  assert.equal(coordinateLabel(-33.87, -70.65), '33.87°S, 70.65°W');
});
