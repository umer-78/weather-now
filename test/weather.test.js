import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCode, formatTemperature, formatPrecipitation, toFahrenheit, windDirection, uvAdvice, windChill,
  summarise, dailyFromResponse, nextHours, forecastQuery, placeLabel, dewPoint, comfortLevel, rangeBar,
  formatWind, reverseQuery, placeFromReverse, formatDistance, rainOutlook, outlookText,
  airQuery, aqiLevel, moonPhase, pressureTrend, visibilityNote, feelsNote, sunProgress,
} from '../src/weather.js';

test('weather codes map to text and an icon', () => {
  assert.equal(describeCode(0).text, 'Clear sky');
  assert.equal(describeCode(95).text, 'Thunderstorm');
  assert.equal(describeCode(1234).text, 'Unknown');
  assert.ok(describeCode(61).icon);
});

test('no sun in the icon after dark', () => {
  assert.equal(describeCode(0).icon, '☀️', 'day unless told otherwise');
  assert.equal(describeCode(0, 1).icon, '☀️');
  assert.equal(describeCode(0, 0).icon, '🌙');
  assert.equal(describeCode(1, 0).icon, '🌙');
  assert.equal(describeCode(2, 0).icon, '☁️');
  assert.equal(describeCode(80, 0).icon, '🌧️');
  assert.equal(describeCode(95, 0).icon, '⛈️', 'icons without a sun stay as they are');
  assert.equal(describeCode(0, 0).text, 'Clear sky');
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

test('precipitation reads like the forecast gives it', () => {
  assert.equal(formatPrecipitation(0), '');
  assert.equal(formatPrecipitation(null), '');
  assert.equal(formatPrecipitation(0.1), '0.1 mm');
  assert.equal(formatPrecipitation(2.44), '2.4 mm');
  assert.equal(formatPrecipitation(12.6), '13 mm');
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
  // the bands apply to the whole-number index the forecast rounds to
  assert.equal(uvAdvice(2.4).level, 'low');
  assert.equal(uvAdvice(2.6).level, 'moderate');
  assert.equal(uvAdvice(7.6).level, 'very high');
  assert.equal(uvAdvice(10.5).level, 'extreme');
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
  // in °F the numbers follow the unit on screen
  assert.equal(summarise({ weather_code: 3, temperature_2m: 30, apparent_temperature: 38 }, 'f'),
    'Overcast, 86° but feels like 100°.');
  assert.equal(summarise({ weather_code: 0, temperature_2m: 20.2, apparent_temperature: 20.4 }, 'f'),
    'Clear sky, 68°.');
});

test('seven-day bars share one scale', () => {
  // a week from 20° to 30°: a 22–27° day starts a fifth in and stops 30% short of the end
  assert.deepEqual(rangeBar(22, 27, 20, 30), { left: 20, right: 30 });
  assert.deepEqual(rangeBar(20, 30, 20, 30), { left: 0, right: 0 });
  assert.deepEqual(rangeBar(25, 25, 25, 25), { left: 0, right: 0 }, 'a flat week still draws');
});

test('daily forecast is grouped with everything the strip shows', () => {
  const days = dailyFromResponse({
    time: ['2026-09-17', '2026-09-18'],
    temperature_2m_max: [33.2, 31],
    temperature_2m_min: [24, 23.5],
    weather_code: [0, 61],
    precipitation_probability_max: [0, 70],
    precipitation_sum: [0, 6.2],
    sunrise: ['2026-09-17T06:12', '2026-09-18T06:13'],
    sunset: ['2026-09-17T18:24', '2026-09-18T18:23'],
  });
  assert.equal(days.length, 2);
  assert.equal(days[1].rainChance, 70);
  assert.equal(days[1].precipitation, 6.2);
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
    precipitation: [0, 0, 0.2, 1.4],
  };
  const from = new Date('2026-09-17T09:30');
  const hours = nextHours(hourly, from, 2);
  assert.deepEqual(hours.map((h) => h.label), ['10:00', '11:00']);
  assert.equal(hours[0].temperature, 28);
  assert.equal(hours[1].precipitation, 1.4);

  // Open-Meteo's current.time is a local wall-clock timestamp. Comparing it
  // as a string keeps hourly selection tied to the forecast timezone rather
  // than the computer running the browser.
  const localHours = nextHours(hourly, '2026-09-17T09:30', 2);
  assert.deepEqual(localHours.map((h) => h.label), ['10:00', '11:00']);
  assert.deepEqual(nextHours(null), []);

  // each hour carries its own day/night flag for the icon
  const evening = nextHours({
    time: ['2026-09-17T18:00', '2026-09-17T19:00'],
    temperature_2m: [30, 28], weather_code: [0, 0], is_day: [1, 0],
  }, '2026-09-17T17:45');
  assert.deepEqual(evening.map((h) => describeCode(h.code, h.isDay).icon), ['☀️', '🌙']);
  // when every hour is in the past, fall back to what there is rather than showing nothing
  assert.equal(nextHours(hourly, new Date('2027-01-01T00:00'), 2).length, 2);
});

test('the forecast URL asks for everything the page renders', () => {
  const url = forecastQuery(31.52, 74.35);
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
  for (const field of ['latitude=31.52', 'longitude=74.35', 'timezone=auto',
    'apparent_temperature', 'precipitation_probability', 'precipitation_sum', 'uv_index_max', 'forecast_days=10']) {
    assert.ok(url.includes(encodeURIComponent(field).replace(/%3D/g, '=').replace(/%2C/g, '%2C')) || url.includes(field),
      `expected ${field} in the query`);
  }
  const params = new URL(url).searchParams;
  assert.ok(params.get('current').split(',').includes('is_day'));
  assert.ok(params.get('hourly').split(',').includes('is_day'));
  assert.ok(params.get('hourly').split(',').includes('precipitation'));
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

test('wind follows the unit system of the temperature', () => {
  assert.equal(formatWind(9.4), '9 km/h');
  assert.equal(formatWind(9.4, 'c'), '9 km/h');
  assert.equal(formatWind(9.4, 'f'), '6 mph');
  assert.equal(formatWind(100, 'f'), '62 mph');
  assert.equal(formatWind(null), '—');
});

test('the forecast asks for gusts as well as the mean wind', () => {
  const current = new URL(forecastQuery(31.52, 74.35)).searchParams.get('current').split(',');
  assert.ok(current.includes('wind_speed_10m') && current.includes('wind_gusts_10m'));
});

test('a reverse lookup asks for as much detail as the map is zoomed to', () => {
  const zoom = (url) => new URL(url).searchParams.get('zoom');
  assert.equal(zoom(reverseQuery(31.5, 74.3)), '10');
  assert.equal(zoom(reverseQuery(31.5, 74.3, 13.6)), '14');
  assert.equal(zoom(reverseQuery(31.5, 74.3, 15.6)), '16');
  assert.equal(zoom(reverseQuery(31.5, 74.3, 19)), '16', 'never finer than a street');
  assert.equal(zoom(reverseQuery(31.5, 74.3, 2)), '8');
  assert.ok(reverseQuery(31.5, 74.3).startsWith('https://nominatim.openstreetmap.org/reverse?'));
});

test('a reverse lookup becomes a place with its province or town', () => {
  assert.deepEqual(placeFromReverse({
    name: 'Lahore', address: { city: 'Lahore', state: 'Punjab', country: 'Pakistan', country_code: 'pk' },
  }), { name: 'Lahore', admin1: 'Punjab', country_code: 'PK' });
  // zoomed in: the neighbourhood, within its town
  assert.deepEqual(placeFromReverse({
    name: 'Gulberg', address: { suburb: 'Gulberg', city: 'Lahore', state: 'Punjab', country_code: 'pk' },
  }), { name: 'Gulberg', admin1: 'Lahore', country_code: 'PK' });
  // no name of its own: the best part of the address
  assert.deepEqual(placeFromReverse({ name: '', address: { village: 'Kalam', state: 'Khyber Pakhtunkhwa', country_code: 'pk' } }),
    { name: 'Kalam', admin1: 'Khyber Pakhtunkhwa', country_code: 'PK' });
  // open water: Nominatim has nothing
  assert.equal(placeFromReverse({ error: 'Unable to geocode' }), null);
  assert.equal(placeFromReverse(null), null);
});

test('the rain check finds the first wet hour, today or tomorrow', () => {
  const hourly = {
    time: ['2026-10-16T14:00', '2026-10-16T15:00', '2026-10-16T16:00', '2026-10-16T23:00', '2026-10-17T03:00'],
    precipitation_probability: [90, 10, 20, 30, 70],
    precipitation: [2, 0, 0, 0.1, 1.2],
    weather_code: [63, 2, 3, 3, 61],
  };
  // the 14:00 shower is over; the chance now is this hour's, and the next wet hour is tomorrow
  const outlook = rainOutlook(hourly, '2026-10-16T15:15');
  assert.equal(outlook.chance, 10);
  assert.deepEqual(outlook.next, { kind: 'Rain', at: '03:00', now: false, tomorrow: true, chance: 70 });
  assert.equal(outlookText(outlook), 'Rain likely from tomorrow 03:00 (70% chance).');
  // raining in this very hour, and snow is called snow
  const snowing = rainOutlook({ ...hourly, weather_code: [73, 73, 73, 73, 73] }, '2026-10-16T14:40');
  assert.equal(outlookText(snowing), 'Snow likely now (90% chance).');
  // a forecast amount counts even where no probability is given
  const noOdds = rainOutlook({ time: hourly.time, precipitation: [0, 0, 0.8, 0, 0] }, '2026-10-16T15:00');
  assert.equal(outlookText(noOdds), 'Rain likely from 16:00.');
  // dry for the next day
  assert.equal(outlookText(rainOutlook({ ...hourly, precipitation_probability: [0, 0, 0, 0, 0], precipitation: [0, 0, 0, 0, 0] }, '2026-10-16T15:00')),
    'No rain expected in the next 24 hours.');
  assert.deepEqual(rainOutlook(null, '2026-10-16T15:00'), { chance: null, next: null });
});

test('hours and days carry their wind', () => {
  const [hour] = nextHours({
    time: ['2026-10-16T16:00'], temperature_2m: [20], weather_code: [0], wind_speed_10m: [14.4], wind_direction_10m: [270],
  }, '2026-10-16T15:30');
  assert.equal(hour.wind, 14.4);
  assert.equal(hour.windDirection, 270);
  const [day] = dailyFromResponse({
    time: ['2026-10-16'], temperature_2m_max: [30], temperature_2m_min: [20], weather_code: [0],
    wind_speed_10m_max: [22], wind_gusts_10m_max: [41], wind_direction_10m_dominant: [315],
  });
  assert.deepEqual([day.wind, day.gusts, day.windDirection], [22, 41, 315]);
  const params = new URL(forecastQuery(31.5, 74.3)).searchParams;
  for (const field of ['cloud_cover', 'pressure_msl', 'visibility']) assert.ok(params.get('current').includes(field), field);
  assert.ok(params.get('daily').includes('wind_gusts_10m_max'));
});

test('visibility reads in km, or miles with °F', () => {
  assert.equal(formatDistance(24140), '24 km');
  assert.equal(formatDistance(8500), '8.5 km');
  assert.equal(formatDistance(24140, 'f'), '15 mi');
  assert.equal(formatDistance(null), '—');
});

test('air quality bands follow the US EPA index', () => {
  assert.equal(aqiLevel(0).level, 'Good');
  assert.equal(aqiLevel(50).level, 'Good');
  assert.equal(aqiLevel(50.4).level, 'Good', 'banded on the whole number');
  assert.equal(aqiLevel(51).level, 'Moderate');
  assert.equal(aqiLevel(151).level, 'Unhealthy');
  assert.equal(aqiLevel(420).level, 'Hazardous');
  assert.equal(aqiLevel(null), null);
  assert.ok(airQuery(31.5, 74.3).startsWith('https://air-quality-api.open-meteo.com/v1/air-quality?'));
  assert.ok(new URL(airQuery(31.5, 74.3)).searchParams.get('current').includes('us_aqi'));
});

test('the moon phase matches known new and full moons', () => {
  assert.equal(moonPhase(new Date(Date.UTC(2024, 3, 8, 18, 21))).name, 'New moon'); // the April 2024 eclipse
  const full = moonPhase(new Date(Date.UTC(2024, 3, 23, 23, 49)));
  assert.equal(full.name, 'Full moon');
  assert.ok(full.lit >= 99);
  assert.equal(moonPhase(new Date(Date.UTC(2024, 3, 15, 19, 13))).name, 'First quarter');
});

test('pressure trend over the next three hours', () => {
  const hourly = { time: ['2026-10-16T15:00', '2026-10-16T16:00', '2026-10-16T17:00', '2026-10-16T18:00'], pressure_msl: [1012, 1012.5, 1013, 1013.4] };
  assert.equal(pressureTrend(hourly, '2026-10-16T15:15'), 'Rising');
  assert.equal(pressureTrend({ ...hourly, pressure_msl: [1012, 1011.5, 1011, 1010.5] }, '2026-10-16T15:15'), 'Falling');
  assert.equal(pressureTrend({ ...hourly, pressure_msl: [1012, 1012, 1012.3, 1012.6] }, '2026-10-16T15:15'), 'Steady');
  assert.equal(pressureTrend({ time: hourly.time }, '2026-10-16T15:15'), null);
});

test('notes that explain the numbers', () => {
  assert.equal(visibilityNote(24000), 'Perfectly clear view.');
  assert.equal(visibilityNote(600), 'Fog: visibility is very poor.');
  assert.equal(feelsNote({ temperature_2m: 5, apparent_temperature: 1, wind_speed_10m: 25 }), 'Wind is making it feel cooler.');
  assert.equal(feelsNote({ temperature_2m: 32, apparent_temperature: 38, relative_humidity_2m: 70 }), 'Humidity is making it feel warmer.');
  assert.equal(feelsNote({ temperature_2m: 20, apparent_temperature: 20.6 }), 'Similar to the actual temperature.');
});

test('where the sun is between sunrise and sunset', () => {
  assert.equal(sunProgress('2026-10-16T12:00', '2026-10-16T06:00', '2026-10-16T18:00'), 0.5);
  assert.equal(sunProgress('2026-10-16T05:00', '2026-10-16T06:00', '2026-10-16T18:00'), null);
  assert.equal(sunProgress('2026-10-16T21:00', '2026-10-16T06:00', '2026-10-16T18:00'), null);
});
