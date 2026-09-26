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
