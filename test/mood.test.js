import test from 'node:test';
import assert from 'node:assert/strict';
import { skyMood } from '../src/mood.js';

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
  assert.deepEqual(skyMood({ ...day, weather_code: 0, wind_speed_10m: 22, wind_direction_10m: 90 }, sun).wind, { speed: 22, direction: 90 });
});
