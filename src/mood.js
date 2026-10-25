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

// Minutes past midnight of a local time such as 2026-10-16T17:38.
const clock = (time) => (time ? Number(time.slice(-5, -3)) * 60 + Number(time.slice(-2)) : null);

/** Where the sun is while it is down: how far below the horizon, in degrees, and whether
 *  it is about to rise in the east. It sinks about a quarter of a degree a minute, so dusk
 *  deepens from gold through blue to dark over an hour or so, and dawn comes the same way. */
export function sunBelow(time, sunrise, sunset) {
  const [now, rise, set] = [clock(time), clock(sunrise), clock(sunset)];
  if (now == null || rise == null || set == null || (now >= rise && now <= set)) return null;
  const sinceSet = (now - set + 1440) % 1440;
  const toRise = (rise - now + 1440) % 1440;
  return { elevation: -Math.min(18, Math.min(sinceSet, toRise) * 0.25), east: toRise < sinceSet };
}

/** Where the moon is: it rises about 50 minutes later each day of its 29.5-day round, so a
 *  full moon rises at sunset and is high at midnight, and a new moon keeps the sun's hours.
 *  Its arc is taken to be the sun's today. `progress` runs from moonrise (0) to moonset (1);
 *  null while it is down. */
export function moonPlace(time, sunrise, sunset, age, latitude, day) {
  const [now, rise, set] = [clock(time), clock(sunrise), clock(sunset)];
  if (now == null || rise == null || set == null || age == null || set <= rise) return null;
  const at = (now - (age / 29.530588853) * 1440 + 2880) % 1440;
  if (at < rise || at > set) return null;
  const progress = (at - rise) / (set - rise);
  return { progress, elevation: sunElevation(progress, latitude, day) };
}

/** An hour of Open-Meteo's hourly forecast, shaped like its current block. */
export function hourConditions(hourly, index) {
  const at = (key) => hourly?.[key]?.[index];
  return {
    time: at('time'), temperature_2m: at('temperature_2m'), relative_humidity_2m: at('relative_humidity_2m'),
    weather_code: at('weather_code'), is_day: at('is_day'), cloud_cover: at('cloud_cover'), precipitation: at('precipitation'),
    visibility: at('visibility'), wind_speed_10m: at('wind_speed_10m'), wind_direction_10m: at('wind_direction_10m'), wind_gusts_10m: at('wind_gusts_10m'),
  };
}

/** Sunrise and sunset on the day of a local time, from Open-Meteo's daily block. */
export function sunTimes(daily, time) {
  const i = Math.max(0, daily?.time?.indexOf(String(time).slice(0, 10)) ?? 0);
  return { sunrise: daily?.sunrise?.[i], sunset: daily?.sunset?.[i] };
}

const dayOfYear = (date) => {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return y && m && d ? Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000) : null;
};

/** `current` is Open-Meteo's current block (or an hour shaped like it); `sunrise`/`sunset`
 *  that day's local times; `moonAge` the moon's age in days, from moonPhase(). */
export function skyMood(current, { sunrise, sunset, latitude, moonAge } = {}) {
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
  const below = sun == null ? sunBelow(current?.time, sunrise, sunset) : null;
  const day = dayOfYear(current?.time);
  const temperature = current?.temperature_2m;
  const speed = current?.wind_speed_10m ?? 0;
  return {
    mood,
    night: current?.is_day === 0,
    // The first and last hour or so of daylight are gold.
    golden: sun != null && (sun < 0.1 || sun > 0.9),
    sun,
    // degrees above the horizon (below it at night), for a sky lit as it really is there and then
    elevation: below ? below.elevation : sunElevation(sun, latitude, day),
    east: below ? below.east : sun != null && sun < 0.5,
    moon: moonPlace(current?.time, sunrise, sunset, moonAge, latitude, day),
    clouds,
    rain: wet ? Math.max(amount, mood === 'storm' ? 0.6 : 0.3) : 0,
    snow: mood === 'snow' ? Math.max(amount * 2, 0.35) : 0,
    lightning: mood === 'storm',
    fog: mood === 'fog' ? Math.max(haze, 0.7) : haze,
    // Hot air shimmers and hazes the sky; below freezing, frost creeps over the glass.
    heat: temperature == null ? 0 : clamp01((temperature - 30) / 12),
    frost: temperature == null ? 0 : clamp01((1 - temperature) / 12),
    humidity: clamp01((current?.relative_humidity_2m ?? 50) / 100),
    wind: { speed, direction: current?.wind_direction_10m ?? 270, gusts: Math.max(speed, current?.wind_gusts_10m ?? speed) },
  };
}
