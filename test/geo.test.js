import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toSphere, fromSphere, facing, coordinateLabel, parseCoordinates, viewSpan, patchFrame,
} from '../src/geo.js';

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

test('a zoomed-in view across the date line is one stretch of the world', () => {
  // Fiji: the view runs from 175°E to 175°W
  const span = viewSpan({ lat: -17, lon: 179 }, [{ lat: -20, lon: 175 }, { lat: -14, lon: -175 }], 0);
  assert.ok(Math.abs(span.lon0 - (-4.2)) < 1e-9 && Math.abs(span.lon1 - 6.2) < 1e-9, JSON.stringify(span));
  assert.ok(span.lat0 < -20 && span.lat1 > -14);
  // a view with the pole in it takes every longitude
  const polar = viewSpan({ lat: 80, lon: 10 }, [{ lat: 86, lon: 170 }, { lat: 75, lon: -100 }]);
  assert.deepEqual([polar.lon0, polar.lon1, polar.lat1], [-180, 180, 90]);
});

test('the sharp patch lines up with the globe: a place is drawn where the sphere puts it', () => {
  const RAD = Math.PI / 180;
  for (const span of [
    { lonC: 74, lon0: -6, lon1: 5, lat0: 25, lat1: 37 },
    { lonC: 179, lon0: -4, lon1: 6, lat0: -22, lat1: -12 }, // across the date line
  ]) {
    const frame = patchFrame(span, 2000, 1500);
    for (const [lat, rel] of [[31.56, 0.35], [span.lat0 + 1, span.lon0 + 1], [span.lat1 - 1, span.lon1 - 1]]) {
      const [px, py] = frame.toPixel(rel * RAD, -lat * RAD);
      // the same point by the sphere's angles, as SphereGeometry spreads its texture
      let phi = (span.lonC + rel + 180) * RAD;
      const u = (phi - frame.phiStart) / frame.phiLength;
      const v = ((90 - lat) * RAD - frame.thetaStart) / frame.thetaLength;
      assert.ok(Math.abs(px / 2000 - u) < 1e-9 && Math.abs(py / 1500 - v) < 1e-9, `${lat}, ${rel}: ${px}, ${py} vs ${u}, ${v}`);
      // and that point on the sphere is the place itself
      phi = frame.phiStart + u * frame.phiLength;
      const back = fromSphere({ x: -Math.cos(phi) * Math.sin(frame.thetaStart + v * frame.thetaLength), y: Math.cos(frame.thetaStart + v * frame.thetaLength), z: Math.sin(phi) * Math.sin(frame.thetaStart + v * frame.thetaLength) });
      const lon = span.lonC + rel - 360 * Math.round((span.lonC + rel) / 360);
      assert.ok(Math.abs(back.lat - lat) < 1e-9 && Math.abs(back.lon - lon) < 1e-9, `${back.lat}, ${back.lon} vs ${lat}, ${lon}`);
    }
  }
});
