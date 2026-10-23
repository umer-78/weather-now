// Sphere maths for the globe, kept apart from three.js so it can be tested.
// The mapping matches three.js SphereGeometry with an equirectangular texture:
// longitude -180 at the texture's left edge, the north pole at the top.

const RAD = Math.PI / 180;

/** Position of a latitude/longitude on a sphere of radius r. */
export function toSphere(lat, lon, r = 1) {
  const phi = (lon + 180) * RAD; // around the axis, from the texture's left edge
  const theta = (90 - lat) * RAD; // down from the north pole
  return {
    x: -r * Math.cos(phi) * Math.sin(theta),
    y: r * Math.cos(theta),
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}

/** Latitude/longitude of a point on the sphere: the inverse of toSphere. */
export function fromSphere({ x, y, z }) {
  const r = Math.hypot(x, y, z);
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, y / r))) / RAD;
  let lon = Math.atan2(z, -x) / RAD - 180;
  if (lon < -180) lon += 360;
  return { lat, lon };
}

/** Rotation that turns a place to face a camera on the +z axis: spin about y, then tilt about x. */
export function facing(lat, lon) {
  const { x, z } = toSphere(lat, lon);
  return { x: lat * RAD, y: -Math.atan2(x, z) };
}

/** "31.56°N, 74.35°E" */
export function coordinateLabel(lat, lon) {
  const part = (value, positive, negative) => `${Math.abs(value).toFixed(2)}°${value < 0 ? negative : positive}`;
  return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'W')}`;
}

/** Typed coordinates — "31.56, 74.35", "31.56°N 74.35°E", "33.9 S, 18.4 E" — or null for anything else. */
export function parseCoordinates(text) {
  const m = String(text ?? '').trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let latitude = Number(m[1]);
  let longitude = Number(m[3]);
  if (m[2] && m[2].toUpperCase() === 'S') latitude = -Math.abs(latitude);
  if (m[4] && m[4].toUpperCase() === 'W') longitude = -Math.abs(longitude);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** The stretch of the world a zoomed-in view shows, from points sampled across it, with a
 *  margin all round so a short drag stays inside. Longitudes are kept relative to the
 *  centre's, so a view across the date line is one stretch, not two; a view with a pole
 *  in it takes every longitude. */
export function viewSpan(center, points, margin = 0.25) {
  let lat0 = center.lat;
  let lat1 = center.lat;
  let lon0 = 0;
  let lon1 = 0;
  for (const { lat, lon } of points) {
    const d = lon - center.lon - 360 * Math.round((lon - center.lon) / 360);
    lat0 = Math.min(lat0, lat);
    lat1 = Math.max(lat1, lat);
    lon0 = Math.min(lon0, d);
    lon1 = Math.max(lon1, d);
  }
  const padLat = (lat1 - lat0) * margin + 0.2;
  const padLon = (lon1 - lon0) * margin + 0.2;
  const span = {
    lonC: center.lon,
    lon0: lon0 - padLon,
    lon1: lon1 + padLon,
    lat0: Math.max(-90, lat0 - padLat),
    lat1: Math.min(90, lat1 + padLat),
  };
  if (span.lon1 - span.lon0 >= 300 || span.lat1 > 84 || span.lat0 < -84) {
    span.lon0 = -180;
    span.lon1 = 180;
    if (span.lat1 > 84) span.lat1 = 90;
    if (span.lat0 < -84) span.lat0 = -90;
  }
  return span;
}

/** Where a span sits on the sphere (the angles of a three.js SphereGeometry segment, which
 *  match toSphere) and where a point lands on a width × height canvas painted for it.
 *  `toPixel` takes an equirectangular projection rotated to the span's centre, in radians
 *  with y pointing south: x = longitude from the centre, y = −latitude. */
export function patchFrame({ lonC, lon0, lon1, lat0, lat1 }, width, height) {
  const sx = width / ((lon1 - lon0) * RAD);
  const sy = height / ((lat1 - lat0) * RAD);
  return {
    phiStart: (lonC + lon0 + 180) * RAD,
    phiLength: (lon1 - lon0) * RAD,
    thetaStart: (90 - lat1) * RAD,
    thetaLength: (lat1 - lat0) * RAD,
    toPixel: (x, y) => [(x - lon0 * RAD) * sx, (y + lat1 * RAD) * sy],
  };
}
