import {
  describeCode, formatTemperature, formatPrecipitation, windDirection, uvAdvice, summarise,
  dailyFromResponse, nextHours, forecastQuery, GEOCODE_URL, placeLabel, dewPoint, comfortLevel, rangeBar,
  formatWind, reverseQuery, placeFromReverse, formatDistance, rainOutlook, outlookText,
  airQuery, aqiLevel, moonPhase, pressureTrend, visibilityNote, feelsNote, sunProgress,
} from './weather.js';
import { coordinateLabel, parseCoordinates } from './geo.js';
import { skyMood } from './mood.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  unit: load('weather:unit') || 'c',
  place: JSON.parse(load('weather:place') || 'null'),
  data: null,
  air: null,
  loadedAt: 0,
};
let globe = null;
let sky = null;

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
  // Air quality is a separate service; without it the page simply has no air tile.
  const [data, air] = await Promise.all([
    getJson(forecastQuery(place.latitude, place.longitude)),
    getJson(airQuery(place.latitude, place.longitude)).catch(() => null),
  ]);
  // Answers can arrive out of order; a slow earlier one must not replace the place asked for last.
  if (request !== latestRequest) return;

  // Only remember a place after its forecast has loaded successfully.
  state.place = place;
  save('weather:place', JSON.stringify(place));
  state.data = data;
  state.air = air?.current ?? null;
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
  const days = dailyFromResponse(data.daily);
  const { icon } = describeCode(current.weather_code, current.is_day);
  $('nowIcon').textContent = icon;
  $('nowTemp').textContent = formatTemperature(current.temperature_2m, unit);
  $('nowPlace').textContent = placeLabel(place);
  $('nowSummary').textContent = summarise(current, unit);
  $('nowRange').textContent = days[0] ? `H: ${formatTemperature(days[0].max, unit)}  L: ${formatTemperature(days[0].min, unit)}` : '';
  const outlook = rainOutlook(data.hourly, current.time);
  $('outlook').textContent = `${outlook.next ? '☔' : '🌤️'} ${outlookText(outlook)}`;
  // Times are the place's own local time, which may not be the viewer's.
  $('updated').textContent = current.time ? `Updated ${current.time.slice(11, 16)} ${data.timezone_abbreviation ?? ''} local time` : '';

  $('hourly').innerHTML = nextHours(data.hourly, current.time, 24).map((hour) => `
    <div class="hour">
      <div class="h">${esc(hour.label)}</div>
      <div class="i">${describeCode(hour.code, hour.isDay).icon}</div>
      <div class="t">${formatTemperature(hour.temperature, unit)}</div>
      <div class="r">${hour.rainChance ? `${hour.rainChance}%` : ''}</div>
      <div class="p">${formatPrecipitation(hour.precipitation)}</div>
      ${hour.wind == null ? '' : `<div class="w" title="Wind from ${windDirection(hour.windDirection)}">${arrow(hour.windDirection)} ${esc(formatWind(hour.wind, unit))}</div>`}
    </div>`).join('');

  const coldest = Math.min(...days.map((d) => d.min));
  const hottest = Math.max(...days.map((d) => d.max));
  $('daily').innerHTML = days.map((day, i) => {
    // Every bar is drawn on the same track, so bars compare across days.
    const { left, right } = rangeBar(day.min, day.max, coldest, hottest);
    return `
    <div class="day">
      <span>${i === 0 ? 'Today' : esc(day.weekday)}${day.wind == null ? '' : `<small class="wind" title="Strongest wind${
        day.gusts == null ? '' : `, gusts to ${esc(formatWind(day.gusts, unit))}`}">${arrow(day.windDirection)} ${esc(formatWind(day.wind, unit))}</small>`}</span>
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

  $('tiles').innerHTML = tiles(data, days, outlook, unit);
  paintSky();
  for (const id of ['current', 'hourlyCard', 'dailyCard', 'detailsCard']) $(id).hidden = false;

  $('globeCaption').textContent = caption(place, data);
  if (globe) {
    $('mapCard').hidden = false;
    globe.setPlace(place, `${icon} ${place.name} · ${formatTemperature(current.temperature_2m, unit)}`);
  }
  document.title = `${formatTemperature(current.temperature_2m, unit)} ${placeLabel(place)} — Weather Now`;
}

/** The sky behind the page shows the weather here: drawn in 3D when it can be, and as a
 *  gradient in the same mood (data-mood) when it cannot. */
function paintSky() {
  const { data } = state;
  if (!data) return;
  const mood = skyMood(data.current, { sunrise: data.daily?.sunrise?.[0], sunset: data.daily?.sunset?.[0], latitude: state.place?.latitude });
  document.documentElement.dataset.mood = mood.night ? 'night' : mood.golden && mood.mood === 'clear' ? 'golden' : mood.mood;
  sky?.set(mood, moonPhase(new Date()));
}

/** A small arrow pointing the way the wind blows (it is named for where it comes from). */
function arrow(degrees) {
  return degrees == null ? '' : `<span class="arrow" style="transform:rotate(${Math.round(degrees) + 180}deg)" aria-hidden="true">↑</span>`;
}

/** One detail tile: a title, the figure, and an optional picture and note. */
function tile(icon, title, value, note = '', picture = '') {
  return `<article class="tile"><h3><span aria-hidden="true">${icon}</span> ${esc(title)}</h3>
    <div class="value">${esc(value)}</div>${picture}${note ? `<p>${esc(note)}</p>` : ''}</article>`;
}

/** The detail tiles, as on a phone's weather app: each figure with what it means. */
function tiles(data, days, outlook, unit) {
  const current = data.current;
  const today = days[0] ?? {};
  const out = [];

  // Air quality, when the air service answered.
  const aqi = state.air?.us_aqi;
  const air = aqiLevel(aqi);
  if (air) {
    out.push(tile('🫁', 'Air quality', `${Math.round(aqi)} · ${air.level}`, `${air.advice}${
      state.air.pm2_5 == null ? '' : ` PM2.5 ${Math.round(state.air.pm2_5)} µg/m³.`}`,
    `<div class="scale aqi"><i style="left:${Math.min(100, (aqi / 300) * 100)}%"></i></div>`));
  }

  const uvMax = data.daily?.uv_index_max?.[0];
  if (uvMax != null) {
    const uv = uvAdvice(uvMax);
    out.push(tile('☀️', 'UV index', `${Math.round(uvMax)} · ${uv.level[0].toUpperCase()}${uv.level.slice(1)}`, `Today's peak. ${uv.advice}`,
      `<div class="scale uv"><i style="left:${Math.min(100, (uvMax / 11) * 100)}%"></i></div>`));
  }

  const rise = data.daily?.sunrise?.[0];
  const set = data.daily?.sunset?.[0];
  if (rise && set) {
    const progress = sunProgress(current.time, rise, set);
    const before = current.time < rise;
    const next = progress != null ? ['Sunset', set] : before ? ['Sunrise', rise] : ['Sunrise', data.daily.sunrise[1] ?? rise];
    const x = 10 + (progress ?? (before ? 0 : 1)) * 140;
    const y = 70 - Math.sin(Math.PI * (progress ?? 0)) * 55;
    out.push(tile(progress != null ? '🌇' : '🌅', next[0], next[1].slice(11, 16),
      next[0] === 'Sunset' ? `Sunrise was ${rise.slice(11, 16)}.` : `Sunset ${set.slice(11, 16)}.`,
      `<svg class="sun" viewBox="0 0 160 80" aria-hidden="true"><path d="M10 70 Q80 -40 150 70" /><line x1="0" y1="70" x2="160" y2="70" />${
        progress == null ? '' : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" />`}</svg>`));
  }

  const dir = current.wind_direction_10m;
  out.push(tile('💨', 'Wind', formatWind(current.wind_speed_10m, unit),
    `From the ${windDirection(dir)}${current.wind_gusts_10m == null ? '' : `, gusts to ${formatWind(current.wind_gusts_10m, unit)}`}.${
      today.gusts == null ? '' : ` Today's strongest gust ${formatWind(today.gusts, unit)}.`}`,
    dir == null ? '' : `<svg class="compass" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" />
      <text x="50" y="16">N</text><text x="88" y="54">E</text><text x="50" y="92">S</text><text x="12" y="54">W</text>
      <g transform="rotate(${Math.round(dir) + 180} 50 50)"><path d="M50 18 L58 34 L50 30 L42 34 Z" /><line x1="50" y1="30" x2="50" y2="82" /></g></svg>`));

  out.push(tile('☔', 'Precipitation', `${formatPrecipitation(current.precipitation) || '0 mm'} now`,
    `${today.precipitation ? `${formatPrecipitation(today.precipitation)} expected today. ` : ''}${
      outlook.chance == null ? '' : `${outlook.chance}% chance this hour. `}${outlookText(outlook)}`));

  out.push(tile('🌡️', 'Feels like', formatTemperature(current.apparent_temperature, unit), feelsNote(current)));

  const dew = dewPoint(current.temperature_2m, current.relative_humidity_2m);
  out.push(tile('💧', 'Humidity', `${current.relative_humidity_2m}%`,
    dew == null ? '' : `The dew point is ${formatTemperature(dew, unit)}: ${comfortLevel(dew)}.`));

  if (current.visibility != null) {
    out.push(tile('👁️', 'Visibility', formatDistance(current.visibility, unit), visibilityNote(current.visibility)));
  }
  if (current.pressure_msl != null) {
    const trend = pressureTrend(data.hourly, current.time);
    out.push(tile('🧭', 'Pressure', `${Math.round(current.pressure_msl)} hPa`, trend ? `${trend} over the next three hours.` : ''));
  }
  if (current.cloud_cover != null) {
    const c = current.cloud_cover;
    out.push(tile('☁️', 'Cloud cover', `${Math.round(c)}%`, c < 20 ? 'Mostly clear skies.' : c < 60 ? 'Some cloud about.' : c < 90 ? 'Mostly cloudy.' : 'Overcast.'));
  }

  const moon = moonPhase(new Date());
  out.push(tile(moon.icon, 'Moon', moon.name, `${moon.lit}% lit.`));
  return out.join('');
}

/** Where the forecast is for: name, coordinates, how sure the location is, and the elevation used. */
function caption(place, data) {
  const coords = coordinateLabel(place.latitude, place.longitude, 4);
  const parts = [place.unnamed && place.name === coordinateLabel(place.latitude, place.longitude) ? coords : `${placeLabel(place)} · ${coords}`];
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
// CDN is missing the card stays hidden and nothing else changes.
import('./globe.js')
  .then(({ createGlobe }) => createGlobe($('globe'), {
    onPick: (latitude, longitude, { name, country_code, detail }) => {
      // A city's name on the globe gives that city; anywhere else is named once its
      // forecast is in, as closely as the globe is zoomed.
      const place = name ? { name, country_code, latitude, longitude } : spot(latitude, longitude, { detail });
      // In the search box too, to four places (about 10 m), so "Copy link" shares this very spot.
      $('place').value = name ?? coordinateLabel(latitude, longitude, 4);
      $('globeCaption').textContent = `Loading the forecast for ${placeLabel(place)}…`;
      globe.setPlace(place, `${place.name} · …`, false);
      show(place).catch(fail);
    },
  }))
  .then((created) => { globe = created; render(); })
  .catch(() => {});

// The 3D sky is an extra too: without WebGL the CSS gradient stays.
import('./sky.js')
  .then(({ createSky }) => { sky = createSky($('sky')); paintSky(); })
  .catch(() => { $('sky').hidden = true; });

// Start with the last place, or Lahore on a first visit.
show(state.place ?? { name: 'Lahore', admin1: 'Punjab', country_code: 'PK', latitude: 31.558, longitude: 74.35 })
  .catch(fail);
