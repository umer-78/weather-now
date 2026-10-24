// What the sky behind the page should show, from the forecast: kept apart from
// three.js so the rules are tested. Every amount is 0 to 1.
import { sunProgress } from './weather.js';

const RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const STORM = new Set([95, 96, 99]);
const FOG = new Set([45, 48]);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** How high the sun stands, in degrees above the horizon, `progress` of the way from
 *  sunrise (0) to sunset (1) at a latitude on a day of the year: its noon height comes
 *  from the latitude and the season's declination, and it follows a smooth arc to it. */
export function sunElevation(progress, latitude, dayOfYear) {
  if (progress == null || latitude == null || dayOfYear == null) return null;
  const declination = 23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const noon = 90 - Math.abs(latitude - declination);
  return Math.max(0, noon) * Math.sin(Math.PI * Math.max(0, Math.min(1, progress)));
}

const dayOfYear = (date) => {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return y && m && d ? Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000) : null;
};

/** `current` is Open-Meteo's current block; `sunrise`/`sunset` today's local times. */
export function skyMood(current, { sunrise, sunset, latitude } = {}) {
  const code = current?.weather_code;
  const mood = STORM.has(code) ? 'storm' : SNOW.has(code) ? 'snow' : RAIN.has(code) ? 'rain'
    : FOG.has(code) ? 'fog' : code >= 2 ? 'cloudy' : 'clear';
  // Cloud cover when the forecast gives it, otherwise what the weather code implies.
  const implied = { clear: code === 1 ? 0.2 : 0.05, cloudy: code === 3 ? 0.95 : 0.55, fog: 0.9, rain: 0.85, snow: 0.85, storm: 1 }[mood];
  const clouds = clamp01(current?.cloud_cover != null ? current.cloud_cover / 100 : implied);
  // Precipitation in mm in the last hour: 4 mm or more is a downpour.
  const amount = clamp01((current?.precipitation ?? 0) / 4);
  const wet = mood === 'rain' || mood === 'storm';
  const visibility = current?.visibility;
  const haze = visibility == null ? 0 : visibility < 1000 ? 0.9 : visibility < 4000 ? 0.5 : visibility < 10000 ? 0.2 : 0;
  const sun = sunProgress(current?.time, sunrise, sunset);
  return {
    mood,
    night: current?.is_day === 0,
    // The first and last hour or so of daylight are gold.
    golden: sun != null && (sun < 0.1 || sun > 0.9),
    sun,
    // degrees above the horizon, for a sky lit as it really is there and then
    elevation: sunElevation(sun, latitude, dayOfYear(current?.time)),
    clouds,
    rain: wet ? Math.max(amount, mood === 'storm' ? 0.6 : 0.3) : 0,
    snow: mood === 'snow' ? Math.max(amount * 2, 0.35) : 0,
    lightning: mood === 'storm',
    fog: mood === 'fog' ? Math.max(haze, 0.7) : haze,
    wind: { speed: current?.wind_speed_10m ?? 0, direction: current?.wind_direction_10m ?? 270 },
  };
}
