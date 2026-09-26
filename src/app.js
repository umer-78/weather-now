import {
  describeCode, formatTemperature, formatPrecipitation, windDirection, uvAdvice, summarise,
  dailyFromResponse, nextHours, forecastQuery, GEOCODE_URL, placeLabel, dewPoint, comfortLevel, rangeBar,
} from './weather.js';
import { coordinateLabel } from './geo.js';

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
    ['Wind', `${Math.round(current.wind_speed_10m)} km/h ${windDirection(current.wind_direction_10m)}`],
    ['Precipitation', `${formatPrecipitation(current.precipitation) || '0 mm'} now · ${
      formatPrecipitation(data.daily?.precipitation_sum?.[0]) || '0 mm'} today`],
    ['UV today', uvMax == null ? '—' : `${Math.round(uvMax)} (${uv.level})`],
    ['Sunrise', data.daily?.sunrise?.[0]?.slice(11, 16) ?? '—'],
    ['Sunset', data.daily?.sunset?.[0]?.slice(11, 16) ?? '—'],
    ['Updated', current.time?.slice(11, 16) ?? '—'],
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

  const coords = coordinateLabel(place.latitude, place.longitude);
  $('globeCaption').textContent = placeLabel(place) === coords ? coords : `${placeLabel(place)} · ${coords}`;
  if (globe) {
    $('mapCard').hidden = false;
    globe.setPlace(place);
  }
  $('units').textContent = unit === 'c' ? '°C' : '°F';
  document.title = `${formatTemperature(current.temperature_2m, unit)} ${placeLabel(place)} — Weather Now`;
}

async function runSearch(query) {
  $('error').textContent = '';
  $('suggestions').hidden = true;
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
}

$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const query = $('place').value.trim();
  if (query) runSearch(query);
});

$('units').addEventListener('click', () => {
  state.unit = state.unit === 'c' ? 'f' : 'c';
  save('weather:unit', state.unit);
  render();
});

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) {
    $('error').textContent = 'This browser cannot share a location.';
    return;
  }
  $('error').textContent = 'Asking for your location…';
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      try {
        await show({ name: 'Your location', latitude: coords.latitude, longitude: coords.longitude });
        $('error').textContent = '';
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
    { timeout: 10000 },
  );
});

// The 3D map is an extra: it loads alongside the forecast, and if WebGL or the
// CDN is missing the card stays hidden and nothing else changes.
import('./globe.js')
  .then(({ createGlobe }) => createGlobe($('globe'), {
    onPick: (latitude, longitude) => show({ name: coordinateLabel(latitude, longitude), latitude, longitude }).catch(fail),
  }))
  .then((created) => { globe = created; render(); })
  .catch(() => {});

// Start with the last place, or Lahore on a first visit.
show(state.place ?? { name: 'Lahore', admin1: 'Punjab', country_code: 'PK', latitude: 31.558, longitude: 74.35 })
  .catch(fail);
