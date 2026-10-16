import {
  describeCode, formatTemperature, formatPrecipitation, windDirection, uvAdvice, summarise,
  dailyFromResponse, nextHours, forecastQuery, GEOCODE_URL, placeLabel, dewPoint, comfortLevel, rangeBar,
  formatWind, reverseQuery, placeFromReverse,
} from './weather.js';
import { coordinateLabel, parseCoordinates } from './geo.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  unit: load('weather:unit') || 'c',
  place: JSON.parse(load('weather:place') || 'null'),
  data: null,
  loadedAt: 0,
};
let globe = null;

function load(key) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`The weather service answered ${response.status}.`);
    return await response.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('The weather service took too long to respond.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function search(query) {
  const url = `${GEOCODE_URL}?${new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' })}`;
  const body = await getJson(url);
  return body.results ?? [];
}

let latestRequest = 0;

async function show(place) {
  const request = ++latestRequest;
  $('error').textContent = '';
  const data = await getJson(forecastQuery(place.latitude, place.longitude));
  // Answers can arrive out of order; a slow earlier one must not replace the place asked for last.
  if (request !== latestRequest) return;

  // Only remember a place after its forecast has loaded successfully.
  state.place = place;
  save('weather:place', JSON.stringify(place));
  state.data = data;
  state.loadedAt = Date.now();
  render();
  if (place.unnamed) nameLater(place);
}

// A spot picked on the map, typed as coordinates or found by the browser gets a
// name from OpenStreetMap once its forecast is showing: at most one lookup a
// second, as Nominatim's usage policy asks, and only for the place still shown.
let lastLookup = 0;
let lookupTimer = 0;
function nameLater(place) {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(async () => {
    lastLookup = Date.now();
    try {
      const found = placeFromReverse(await getJson(reverseQuery(place.latitude, place.longitude, place.detail)));
      if (!found || state.place !== place) return; // open water, or the page has moved on
      state.place = { ...place, ...found, unnamed: false };
      save('weather:place', JSON.stringify(state.place));
      render();
    } catch { /* the coordinates stay as its name */ }
  }, Math.max(0, lastLookup + 1100 - Date.now()));
}

/** A point on the map, by its coordinates until it has a name. */
function spot(latitude, longitude, extra = {}) {
  return { name: coordinateLabel(latitude, longitude), latitude, longitude, unnamed: true, ...extra };
}

// Open-Meteo updates current conditions every 15 minutes. A tab left open, or
// brought back from the back/forward cache, reloads rather than show old "now".
const STALE_AFTER = 15 * 60 * 1000;
function refreshIfStale() {
  if (document.hidden || !state.data || Date.now() - state.loadedAt < STALE_AFTER) return;
  state.loadedAt = Date.now(); // one attempt at a time
  show(state.place).catch(fail);
}
document.addEventListener('visibilitychange', refreshIfStale);
window.addEventListener('pageshow', refreshIfStale);
setInterval(refreshIfStale, 60 * 1000);

/** The units button names the unit in use, whether or not a forecast has loaded yet. */
function showUnit() {
  $('units').textContent = state.unit === 'c' ? '°C' : '°F';
}

function render() {
  const { data, place, unit } = state;
  if (!data) return;
  const current = data.current;
  const { icon } = describeCode(current.weather_code, current.is_day);
  $('nowIcon').textContent = icon;
  $('nowTemp').textContent = formatTemperature(current.temperature_2m, unit);
  $('nowPlace').textContent = placeLabel(place);
  $('nowSummary').textContent = summarise(current, unit);

  const uvMax = data.daily?.uv_index_max?.[0];
  const uv = uvAdvice(uvMax);
  const dew = dewPoint(current.temperature_2m, current.relative_humidity_2m);
  const facts = [
    ['Feels like', formatTemperature(current.apparent_temperature, unit)],
    ['Humidity', `${current.relative_humidity_2m}%`],
    ['Dew point', dew == null ? '—' : `${formatTemperature(dew, unit)} (${comfortLevel(dew)})`],
    ['Wind', `${formatWind(current.wind_speed_10m, unit)} ${windDirection(current.wind_direction_10m)}${
      current.wind_gusts_10m == null ? '' : `, gusts ${formatWind(current.wind_gusts_10m, unit)}`}`],
    ['Precipitation', `${formatPrecipitation(current.precipitation) || '0 mm'} now · ${
      formatPrecipitation(data.daily?.precipitation_sum?.[0]) || '0 mm'} today`],
    ['UV today', uvMax == null ? '—' : `${Math.round(uvMax)} (${uv.level})`],
    ['Sunrise', data.daily?.sunrise?.[0]?.slice(11, 16) ?? '—'],
    ['Sunset', data.daily?.sunset?.[0]?.slice(11, 16) ?? '—'],
    // Times are the place's own local time, which may not be the viewer's.
    ['Updated', current.time ? `${current.time.slice(11, 16)} ${data.timezone_abbreviation ?? ''}`.trim() : '—'],
  ];
  $('facts').innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  $('hourly').innerHTML = nextHours(data.hourly, data.current?.time).map((hour) => `
    <div class="hour">
      <div class="h">${esc(hour.label)}</div>
      <div class="i">${describeCode(hour.code, hour.isDay).icon}</div>
      <div class="t">${formatTemperature(hour.temperature, unit)}</div>
      <div class="r">${hour.rainChance ? `${hour.rainChance}%` : ''}</div>
      <div class="p">${formatPrecipitation(hour.precipitation)}</div>
    </div>`).join('');

  const days = dailyFromResponse(data.daily);
  const coldest = Math.min(...days.map((d) => d.min));
  const hottest = Math.max(...days.map((d) => d.max));
  $('daily').innerHTML = days.map((day, i) => {
    // Every bar is drawn on the same track, so bars compare across days.
    const { left, right } = rangeBar(day.min, day.max, coldest, hottest);
    return `
    <div class="day">
      <span>${i === 0 ? 'Today' : esc(day.weekday)}</span>
      <span class="ic" title="${esc(describeCode(day.code).text)}">${describeCode(day.code).icon}${
        day.rainChance ? `<small>${day.rainChance}%<span class="sr-only"> chance of precipitation</span></small>` : ''}${
        formatPrecipitation(day.precipitation) ? `<small class="mm">${formatPrecipitation(day.precipitation)}</small>` : ''}</span>
      <span class="range">
        <span class="lo">${formatTemperature(day.min, unit)}</span>
        <span class="track"><span class="bar" style="clip-path:inset(0 ${right}% 0 ${left}% round 3px)"></span></span>
      </span>
      <span class="hi">${formatTemperature(day.max, unit)}</span>
    </div>`;
  }).join('');

  for (const id of ['current', 'hourlyCard', 'dailyCard']) $(id).hidden = false;

  $('globeCaption').textContent = caption(place, data);
  if (globe) {
    $('mapCard').hidden = false;
    globe.setPlace(place, `${place.name} · ${formatTemperature(current.temperature_2m, unit)}`);
  }
  document.title = `${formatTemperature(current.temperature_2m, unit)} ${placeLabel(place)} — Weather Now`;
}

/** Where the forecast is for: name, coordinates, how sure the location is, and the elevation used. */
function caption(place, data) {
  const coords = coordinateLabel(place.latitude, place.longitude);
  const parts = [placeLabel(place) === coords ? coords : `${placeLabel(place)} · ${coords}`];
  if (place.accuracy) parts.push(`located to ±${place.accuracy < 1000 ? `${Math.round(place.accuracy)} m` : `${Math.round(place.accuracy / 1000)} km`}`);
  if (Number.isFinite(data?.elevation)) parts.push(`elevation ${Math.round(data.elevation)} m`);
  return parts.join(' · ');
}

async function runSearch(query) {
  $('error').textContent = '';
  $('suggestions').hidden = true;
  const typed = parseCoordinates(query);
  if (typed) return show(spot(typed.latitude, typed.longitude)).catch(fail);
  try {
    const results = await search(query);
    if (!results.length) {
      $('error').textContent = `Nothing found for "${query}".`;
      return;
    }
    if (results.length === 1) return show(results[0]);
    $('suggestions').innerHTML = results.map((place, i) =>
      `<button type="button" data-index="${i}">${esc(placeLabel(place))}</button>`).join('');
    $('suggestions').hidden = false;
    $('suggestions').querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        $('suggestions').hidden = true;
        $('place').value = results[Number(button.dataset.index)].name;
        show(results[Number(button.dataset.index)]).catch(fail);
      });
    });
  } catch (err) {
    fail(err);
  }
}

function fail(err) {
  $('error').textContent = `${err.message} Check your connection and try again.`;
  // A pick that failed must not leave the marker on a spot whose weather is not shown.
  render();
}

$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const query = $('place').value.trim();
  if (query) runSearch(query);
});

$('units').addEventListener('click', () => {
  state.unit = state.unit === 'c' ? 'f' : 'c';
  save('weather:unit', state.unit);
  showUnit();
  render();
});
showUnit();

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    $('error').textContent = 'This browser cannot share a location.';
    return;
  }
  $('error').textContent = 'Asking for your location…';
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      try {
        // Three decimals is about 100 m: finer than any forecast grid, and no more precise than needed.
        const round = (value) => Math.round(value * 1000) / 1000;
        await show(spot(round(coords.latitude), round(coords.longitude), { name: 'Your location', accuracy: coords.accuracy }));
        // Without GPS a browser may only know the city, or less; say so rather than imply precision.
        $('error').textContent = coords.accuracy > 5000
          ? `Your browser could only place you to within about ${Math.round(coords.accuracy / 1000)} km. Search for your town for a closer forecast.`
          : '';
      } catch (err) { fail(err); }
    },
    (err) => {
      const messages = {
        1: 'Location permission was denied.',
        2: 'Your location could not be determined.',
        3: 'Location lookup timed out.',
      };
      $('error').textContent = messages[err.code] ?? 'Unable to determine your location.';
    },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 },
  );
});

// The 3D map is an extra: it loads alongside the forecast, and if WebGL or the
// CDN is missing the card goes away and nothing else changes.
const first = state.place ?? { name: 'Lahore', admin1: 'Punjab', country_code: 'PK', latitude: 31.558, longitude: 74.35 };
$('mapCard').hidden = false; // the map needs its size to start
import('./globe.js')
  .then(({ createGlobe }) => createGlobe($('globe'), {
    center: [first.longitude, first.latitude],
    onPick: (latitude, longitude, { name, zoom }) => {
      // A place name on the map gives that place; anywhere else is named once its forecast is in,
      // as closely as the map is zoomed.
      const place = name ? { name, latitude, longitude } : spot(latitude, longitude, { detail: zoom });
      // In the search box too, so "Copy link" shares this spot.
      $('place').value = place.name;
      $('globeCaption').textContent = `Loading the forecast for ${placeLabel(place)}…`;
      globe.setPlace(place, `${place.name} · …`, false);
      show(place).catch(fail);
    },
  }))
  .then((created) => { globe = created; render(); })
  .catch(() => { $('mapCard').hidden = true; });

// Start with the last place, or Lahore on a first visit.
show(first).catch(fail);
