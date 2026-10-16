// Coordinates as people read and type them, kept apart from the map so they can be tested.

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
