import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCode, formatTemperature, toFahrenheit, windDirection, uvAdvice, windChill,
  summarise, dailyFromResponse, nextHours, forecastQuery, placeLabel, dewPoint, comfortLevel,
} from '../src/weather.js';

test('weather codes map to text and an icon', () => {
  assert.equal(describeCode(0).text, 'Clear sky');
  assert.equal(describeCode(95).text, 'Thunderstorm');
  assert.equal(describeCode(1234).text, 'Unknown');
  assert.ok(describeCode(61).icon);
});

test('temperature formatting and conversion', () => {
  assert.equal(formatTemperature(21.4), '21°C');
  assert.equal(formatTemperature(21.6), '22°C');
  assert.equal(formatTemperature(0, 'f'), '32°F');
  assert.equal(formatTemperature(100, 'f'), '212°F');
  assert.equal(toFahrenheit(-40), -40);
  assert.equal(formatTemperature(null), '—');
  assert.equal(formatTemperature(NaN), '—');
});

test('wind direction handles every quadrant and wraps', () => {
  assert.equal(windDirection(0), 'N');
  assert.equal(windDirection(90), 'E');
  assert.equal(windDirection(180), 'S');
  assert.equal(windDirection(270), 'W');
  assert.equal(windDirection(360), 'N');
  assert.equal(windDirection(-90), 'W');
  assert.equal(windDirection(45), 'NE');
});

test('uv advice follows the WHO bands', () => {
  assert.equal(uvAdvice(1).level, 'low');
  assert.equal(uvAdvice(5).level, 'moderate');
  assert.equal(uvAdvice(7).level, 'high');
  assert.equal(uvAdvice(9).level, 'very high');
  assert.equal(uvAdvice(12).level, 'extreme');
  assert.equal(uvAdvice(null).level, 'unknown');
});

test('wind chill only applies in cold, windy conditions', () => {
  assert.equal(windChill(20, 30), 20, 'no chill above 10°C');
  assert.equal(windChill(0, 2), 0, 'no chill in still air');
  assert.ok(windChill(0, 30) < -5, 'freezing and windy feels much colder');
});

test('the summary mentions "feels like" only when it differs', () => {
  assert.equal(summarise({ weather_code: 0, temperature_2m: 20.2, apparent_temperature: 20.4 }),
    'Clear sky, 20°.');
  assert.equal(summarise({ weather_code: 3, temperature_2m: 30, apparent_temperature: 38 }),
    'Overcast, 30° but feels like 38°.');
});

test('daily forecast is grouped with everything the strip shows', () => {
  const days = dailyFromResponse({
    time: ['2026-09-17', '2026-09-18'],
    temperature_2m_max: [33.2, 31],
    temperature_2m_min: [24, 23.5],
    weather_code: [0, 61],
    precipitation_probability_max: [0, 70],
    sunrise: ['2026-09-17T06:12', '2026-09-18T06:13'],
    sunset: ['2026-09-17T18:24', '2026-09-18T18:23'],
  });
  assert.equal(days.length, 2);
  assert.equal(days[1].rainChance, 70);
  assert.equal(days[0].sunrise, '06:12');
  assert.equal(days[0].weekday, 'Thu');
  assert.equal(days[1].weekday, 'Fri');
  assert.deepEqual(dailyFromResponse(null), []);
});

test('hourly starts from now, not from midnight', () => {
  const hourly = {
    time: ['2026-09-17T08:00', '2026-09-17T09:00', '2026-09-17T10:00', '2026-09-17T11:00'],
    temperature_2m: [24, 26, 28, 30],
    weather_code: [0, 0, 1, 2],
    precipitation_probability: [0, 0, 10, 20],
  };
  const from = new Date('2026-09-17T09:30');
  const hours = nextHours(hourly, from, 2);
  assert.deepEqual(hours.map((h) => h.label), ['10:00', '11:00']);
  assert.equal(hours[0].temperature, 28);

  // Open-Meteo's current.time is a local wall-clock timestamp. Comparing it
  // as a string keeps hourly selection tied to the forecast timezone rather
  // than the computer running the browser.
  const localHours = nextHours(hourly, '2026-09-17T09:30', 2);
  assert.deepEqual(localHours.map((h) => h.label), ['10:00', '11:00']);
  assert.deepEqual(nextHours(null), []);
  // when every hour is in the past, fall back to what there is rather than showing nothing
  assert.equal(nextHours(hourly, new Date('2027-01-01T00:00'), 2).length, 2);
});

test('the forecast URL asks for everything the page renders', () => {
  const url = forecastQuery(31.52, 74.35);
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
  for (const field of ['latitude=31.52', 'longitude=74.35', 'timezone=auto',
    'apparent_temperature', 'precipitation_probability', 'uv_index_max', 'forecast_days=7']) {
    assert.ok(url.includes(encodeURIComponent(field).replace(/%3D/g, '=').replace(/%2C/g, '%2C')) || url.includes(field),
      `expected ${field} in the query`);
  }
});

test('place labels skip missing parts', () => {
  assert.equal(placeLabel({ name: 'Lahore', admin1: 'Punjab', country_code: 'PK' }), 'Lahore, Punjab, PK');
  assert.equal(placeLabel({ name: 'Singapore', country_code: 'SG' }), 'Singapore, SG');
});

test('dew point matches reference values', () => {
  // 20 °C at 50 % RH is about 9.3 °C; saturated air's dew point equals its temperature
  assert.ok(Math.abs(dewPoint(20, 50) - 9.3) < 0.1);
  assert.ok(Math.abs(dewPoint(25, 100) - 25) < 1e-9);
  assert.ok(dewPoint(-5, 80) < -5);
  assert.equal(dewPoint(20, 0), null);
  assert.equal(dewPoint(null, 50), null);
});

test('comfort bands follow the dew point', () => {
  assert.equal(comfortLevel(5), 'dry');
  assert.equal(comfortLevel(12), 'comfortable');
  assert.equal(comfortLevel(18), 'humid');
  assert.equal(comfortLevel(22), 'muggy');
  assert.equal(comfortLevel(26), 'oppressive');
  assert.equal(comfortLevel(null), 'unknown');
});
