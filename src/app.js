import {
  describeCode, formatTemperature, windDirection, uvAdvice, summarise,
  dailyFromResponse, nextHours, forecastQuery, GEOCODE_URL, placeLabel,
} from './weather.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  unit: load('weather:unit') || 'c',
  place: JSON.parse(load('weather:place') || 'null'),
  data: null,
};

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

async function show(place) {
  $('error').textContent = '';
  const data = await getJson(forecastQuery(place.latitude, place.longitude));

  // Only remember a place after its forecast has loaded successfully.
  state.place = place;
  save('weather:place', JSON.stringify(place));
  state.data = data;
  render();
}

function render() {
  const { data, place, unit } = state;
  if (!data) return;
  const current = data.current;
  const { icon } = describeCode(current.weather_code);
  $('nowIcon').textContent = icon;
  $('nowTemp').textContent = formatTemperature(current.temperature_2m, unit);
  $('nowPlace').textContent = placeLabel(place);
  $('nowSummary').textContent = summarise(current);

  const uv = uvAdvice(data.daily?.uv_index_max?.[0]);
  const facts = [
    ['Feels like', formatTemperature(current.apparent_temperature, unit)],
    ['Humidity', `${current.relative_humidity_2m}%`],
    ['Wind', `${Math.round(current.wind_speed_10m)} km/h ${windDirection(current.wind_direction_10m)}`],
    ['Rain now', `${current.precipitation ?? 0} mm`],
    ['UV today', `${data.daily?.uv_index_max?.[0] ?? '—'} (${uv.level})`],
    ['Sunrise', data.daily?.sunrise?.[0]?.slice(11, 16) ?? '—'],
    ['Sunset', data.daily?.sunset?.[0]?.slice(11, 16) ?? '—'],
  ];
  $('facts').innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  $('hourly').innerHTML = nextHours(data.hourly, data.current?.time).map((hour) => `
    <div class="hour">
      <div class="h">${esc(hour.label)}</div>
      <div class="i">${describeCode(hour.code).icon}</div>
      <div class="t">${formatTemperature(hour.temperature, unit)}</div>
      <div class="r">${hour.rainChance ? `${hour.rainChance}%` : ''}</div>
    </div>`).join('');

  const days = dailyFromResponse(data.daily);
  const coldest = Math.min(...days.map((d) => d.min));
  const hottest = Math.max(...days.map((d) => d.max));
  const span = hottest - coldest || 1;
  $('daily').innerHTML = days.map((day, i) => `
    <div class="day">
      <span>${i === 0 ? 'Today' : esc(day.weekday)}</span>
      <span title="${esc(describeCode(day.code).text)}">${describeCode(day.code).icon}</span>
      <span class="range">
        <span>${formatTemperature(day.min, unit)}</span>
        <span class="bar" style="margin-left:${((day.min - coldest) / span) * 40}%;
          margin-right:${((hottest - day.max) / span) * 40}%"></span>
        <span>${day.rainChance ? `${day.rainChance}% rain` : ''}</span>
      </span>
      <span class="hi">${formatTemperature(day.max, unit)}</span>
    </div>`).join('');

  for (const id of ['current', 'hourlyCard', 'dailyCard']) $(id).hidden = false;
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

// Start with the last place, or Lahore on a first visit.
show(state.place ?? { name: 'Lahore', admin1: 'Punjab', country_code: 'PK', latitude: 31.558, longitude: 74.35 })
  .catch(fail);
