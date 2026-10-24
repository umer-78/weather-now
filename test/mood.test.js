import test from 'node:test';
import assert from 'node:assert/strict';
import { skyMood, sunElevation, sunBelow, moonPlace, hourConditions, sunTimes } from '../src/mood.js';

const day = { time: '2026-10-16T12:00', is_day: 1 };
const sun = { sunrise: '2026-10-16T06:00', sunset: '2026-10-16T18:00' };

test('the sky follows the weather code', () => {
  assert.equal(skyMood({ ...day, weather_code: 0 }, sun).mood, 'clear');
  assert.equal(skyMood({ ...day, weather_code: 3 }, sun).mood, 'cloudy');
  assert.equal(skyMood({ ...day, weather_code: 45 }, sun).mood, 'fog');
  assert.equal(skyMood({ ...day, weather_code: 63 }, sun).mood, 'rain');
  assert.equal(skyMood({ ...day, weather_code: 73 }, sun).mood, 'snow');
  const storm = skyMood({ ...day, weather_code: 95 }, sun);
  assert.equal(storm.mood, 'storm');
  assert.ok(storm.lightning && storm.rain >= 0.6);
});

test('clouds, rain and mist come from the measured amounts', () => {
  assert.equal(skyMood({ ...day, weather_code: 2, cloud_cover: 40 }, sun).clouds, 0.4);
  assert.equal(skyMood({ ...day, weather_code: 3 }, sun).clouds, 0.95, 'implied when cover is missing');
  assert.equal(skyMood({ ...day, weather_code: 65, precipitation: 8 }, sun).rain, 1, 'a downpour is full rain');
  assert.equal(skyMood({ ...day, weather_code: 61, precipitation: 0.2 }, sun).rain, 0.3, 'drizzle still shows');
  assert.equal(skyMood({ ...day, weather_code: 0, precipitation: 3 }, sun).rain, 0, 'no rain from a clear code');
  assert.equal(skyMood({ ...day, weather_code: 0, visibility: 600 }, sun).fog, 0.9);
  assert.equal(skyMood({ ...day, weather_code: 0, visibility: 30000 }, sun).fog, 0);
});

test('night, golden hour and the wind', () => {
  assert.equal(skyMood({ ...day, is_day: 0, weather_code: 0 }, sun).night, true);
  assert.equal(skyMood({ ...day, time: '2026-10-16T17:30', weather_code: 0 }, sun).golden, true);
  assert.equal(skyMood({ ...day, weather_code: 0 }, sun).golden, false);
  assert.deepEqual(skyMood({ ...day, weather_code: 0, wind_speed_10m: 22, wind_direction_10m: 90 }, sun).wind, { speed: 22, direction: 90, gusts: 22 });
  assert.equal(skyMood({ ...day, weather_code: 0, wind_speed_10m: 22, wind_gusts_10m: 41 }, sun).wind.gusts, 41);
});

test('the sun stands as high as it really does there', () => {
  // the equator at an equinox: overhead at noon
  assert.ok(Math.abs(sunElevation(0.5, 0, 80) - 90) < 2);
  // Lahore, 31.5°N: about 82° at noon in late June, about 35° in late December
  assert.ok(Math.abs(sunElevation(0.5, 31.5, 172) - 82) < 1.5);
  assert.ok(Math.abs(sunElevation(0.5, 31.5, 355) - 35) < 1.5);
  // on the horizon at sunrise and sunset, and nothing to show without a place or a day
  assert.equal(sunElevation(0, 31.5, 172), 0);
  assert.ok(sunElevation(1, 31.5, 172) < 1e-9);
  assert.equal(sunElevation(null, 31.5, 172), null);
  const mood = skyMood({ time: '2026-06-21T12:30', is_day: 1, weather_code: 0 }, { sunrise: '2026-06-21T05:00', sunset: '2026-06-21T19:10', latitude: 31.5 });
  assert.ok(mood.elevation > 75 && mood.elevation < 84, String(mood.elevation));
});

test('after sunset the sun sinks, and rises again in the east', () => {
  assert.equal(sunBelow('2026-10-16T12:00', sun.sunrise, sun.sunset), null, 'up by day');
  assert.deepEqual(sunBelow('2026-10-16T18:20', sun.sunrise, sun.sunset), { elevation: -5, east: false });
  assert.deepEqual(sunBelow('2026-10-16T05:40', sun.sunrise, sun.sunset), { elevation: -5, east: true });
  assert.equal(sunBelow('2026-10-16T23:30', sun.sunrise, sun.sunset).elevation, -18, 'full night');
  const dusk = skyMood({ time: '2026-10-16T18:20', is_day: 0, weather_code: 0 }, sun);
  assert.equal(dusk.night, true);
  assert.equal(dusk.elevation, -5);
});

test('the moon keeps its own hours', () => {
  // full moon: rises at sunset, high at midnight; new moon: down all night
  const full = moonPlace('2026-10-16T00:00', sun.sunrise, sun.sunset, 14.765, 31.5, 289);
  assert.ok(Math.abs(full.progress - 0.5) < 0.01);
  assert.ok(full.elevation > 40);
  assert.equal(moonPlace('2026-10-16T23:00', sun.sunrise, sun.sunset, 0.2, 31.5, 289), null);
  // first quarter: in the west in the evening
  assert.ok(moonPlace('2026-10-16T21:00', sun.sunrise, sun.sunset, 7.38, 31.5, 289).progress > 0.7);
  assert.equal(skyMood({ time: '2026-10-16T21:00', is_day: 0, weather_code: 0 }, { ...sun, moonAge: 0.2 }).moon, null);
});

test('heat, frost and any hour of the forecast', () => {
  assert.equal(skyMood({ ...day, weather_code: 0, temperature_2m: 42 }, sun).heat, 1);
  assert.equal(skyMood({ ...day, weather_code: 0, temperature_2m: 20 }, sun).heat, 0);
  assert.equal(skyMood({ ...day, weather_code: 0, temperature_2m: -11 }, sun).frost, 1);
  assert.equal(skyMood({ ...day, weather_code: 0, temperature_2m: 5 }, sun).frost, 0);
  const hourly = { time: ['2026-10-16T13:00', '2026-10-16T14:00'], weather_code: [0, 63], is_day: [1, 1], cloud_cover: [10, 100], precipitation: [0, 2], temperature_2m: [24, 19] };
  const later = hourConditions(hourly, 1);
  assert.equal(later.time, '2026-10-16T14:00');
  assert.equal(skyMood(later, sun).mood, 'rain');
  assert.equal(skyMood(later, sun).clouds, 1);
  const daily = { time: ['2026-10-16', '2026-10-17'], sunrise: ['2026-10-16T06:12', '2026-10-17T06:13'], sunset: ['2026-10-16T17:38', '2026-10-17T17:37'] };
  assert.deepEqual(sunTimes(daily, '2026-10-17T09:00'), { sunrise: '2026-10-17T06:13', sunset: '2026-10-17T17:37' });
  assert.equal(sunTimes(daily, '2027-01-01T09:00').sunrise, '2026-10-16T06:12', 'today when the day is not in the forecast');
});
