// Pure helpers: turning Open-Meteo's response into something a person can read.
// No DOM and no fetch here, so every rule below is unit tested.

// https://open-meteo.com/en/docs — WMO weather codes
const CODES = {
  0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Rain showers', '🌦️'], 81: ['Rain showers', '🌧️'], 82: ['Violent rain showers', '⛈️'],
  85: ['Snow showers', '🌨️'], 86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm with hail', '⛈️'], 99: ['Thunderstorm with hail', '⛈️'],
};

// Icons with the sun in them, and what to show instead after dark.
const NIGHT = { '☀️': '🌙', '🌤️': '🌙', '⛅': '☁️', '🌦️': '🌧️' };

/** `isDay` is Open-Meteo's is_day: 1 in daylight, 0 at night. */
export function describeCode(code, isDay = 1) {
  const [text, icon] = CODES[code] ?? ['Unknown', '❓'];
  return { text, icon: isDay === 0 ? NIGHT[icon] ?? icon : icon };
}

export const toFahrenheit = (celsius) => (celsius * 9) / 5 + 32;

/** Precipitation as the forecast gives it (0.1 mm steps); '' when there is none. */
export function formatPrecipitation(mm) {
  if (mm == null || Number.isNaN(mm) || mm < 0.05) return '';
  return `${mm < 10 ? Math.round(mm * 10) / 10 : Math.round(mm)} mm`;
}

export function formatTemperature(celsius, unit = 'c') {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return '—';
  const value = unit === 'f' ? toFahrenheit(celsius) : celsius;
  return `${Math.round(value)}°${unit.toUpperCase()}`;
}

/** Wind speed in the unit system that goes with the temperature: km/h with °C, mph with °F. */
export function formatWind(kmh, unit = 'c') {
  if (kmh == null || Number.isNaN(kmh)) return '—';
  return unit === 'f' ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`;
}

/** Visibility and other distances: km with °C, miles with °F. */
export function formatDistance(meters, unit = 'c') {
  if (meters == null || Number.isNaN(meters)) return '—';
  const value = unit === 'f' ? meters / 1609.344 : meters / 1000;
  return `${value < 10 ? Math.round(value * 10) / 10 : Math.round(value)} ${unit === 'f' ? 'mi' : 'km'}`;
}

/** Compass point from a bearing in degrees. */
export function windDirection(degrees) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** UV index bands, as published by the WHO. */
export function uvAdvice(index) {
  if (index === null || index === undefined || !Number.isFinite(+index) || index < 0) return { level: 'unknown', advice: '' };
  // The bands are defined on the whole-number index, so 7.6 is 8: very high.
  index = Math.round(index);
  // Advice as the WHO's UV index guide gives it, in plain words.
  if (index < 3) return { level: 'low', advice: 'Little risk for most people. Sunglasses on bright days; sunscreen if you burn easily or are near snow or water.' };
  if (index < 6) return { level: 'moderate', advice: 'Seek shade around midday. Cover up, and wear a hat, sunglasses and SPF 30+ sunscreen.' };
  if (index < 8) return { level: 'high', advice: 'Cut time in the sun around midday (roughly 10am–4pm). Shade, a shirt, hat, sunglasses and SPF 30+, reapplied every two hours.' };
  if (index < 11) return { level: 'very high', advice: 'Extra protection needed: avoid the sun around midday (roughly 10am–4pm); unprotected skin burns quickly.' };
  return { level: 'extreme', advice: 'Avoid being outside around midday; unprotected skin can burn very quickly. Full cover, hat, sunglasses and SPF 30+.' };
}

/** "Feels like" is already provided by the API; this is the wind-chill side of
 *  it, kept for the explanation panel. */
export function windChill(celsius, windKph) {
  if (celsius > 10 || windKph < 4.8) return celsius;
  return 13.12 + 0.6215 * celsius - 11.37 * windKph ** 0.16 + 0.3965 * celsius * windKph ** 0.16;
}

/** Dew point in °C from air temperature and relative humidity (Magnus formula). */
export function dewPoint(celsius, humidity) {
  if (celsius == null || humidity == null || humidity <= 0) return null;
  const a = 17.62;
  const b = 243.12;
  const gamma = Math.log(Math.min(humidity, 100) / 100) + (a * celsius) / (b + celsius);
  return (b * gamma) / (a - gamma);
}

/** How the air feels, from the dew point: the usual comfort bands. */
export function comfortLevel(dewPointC) {
  if (dewPointC == null) return 'unknown';
  if (dewPointC < 10) return 'dry';
  if (dewPointC < 16) return 'comfortable';
  if (dewPointC < 21) return 'humid';
  if (dewPointC < 24) return 'muggy';
  return 'oppressive';
}

export function summarise(current, unit = 'c') {
  const { text } = describeCode(current.weather_code);
  // Decided in °C, so switching units does not change whether it is mentioned.
  const difference = Math.round(current.apparent_temperature) - Math.round(current.temperature_2m);
  const shown = (celsius) => Math.round(unit === 'f' ? toFahrenheit(celsius) : celsius);
  if (Math.abs(difference) >= 3) {
    return `${text}, ${shown(current.temperature_2m)}° but feels like ${shown(current.apparent_temperature)}°.`;
  }
  return `${text}, ${shown(current.temperature_2m)}°.`;
}

/** Where a day's min–max sits on the week's scale: CSS percentages in from each end. */
export function rangeBar(min, max, coldest, hottest) {
  const span = hottest - coldest || 1;
  return { left: ((min - coldest) * 100) / span, right: ((hottest - max) * 100) / span };
}

/** Group the hourly series into days for the forecast strip. */
export function dailyFromResponse(daily) {
  if (!daily?.time?.length) return [];
  return daily.time.map((date, i) => ({
    date,
    // Open-Meteo's daily `date` is already the calendar date in the
    // requested forecast timezone. Using UTC here prevents the computer's
    // local timezone from changing the displayed weekday.
    weekday: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    max: daily.temperature_2m_max[i],
    min: daily.temperature_2m_min[i],
    code: daily.weather_code[i],
    rainChance: daily.precipitation_probability_max?.[i] ?? null,
    precipitation: daily.precipitation_sum?.[i] ?? null,
    wind: daily.wind_speed_10m_max?.[i] ?? null,
    gusts: daily.wind_gusts_10m_max?.[i] ?? null,
    windDirection: daily.wind_direction_10m_dominant?.[i] ?? null,
    sunrise: daily.sunrise?.[i]?.slice(11, 16) ?? null,
    sunset: daily.sunset?.[i]?.slice(11, 16) ?? null,
  }));
}

/** Next 12 hours from "now", skipping the hours already gone. */
export function nextHours(hourly, from = new Date(), count = 12) {
  if (!hourly?.time?.length) return [];

  // Open-Meteo returns local wall-clock timestamps when timezone=auto.
  // Prefer its current.time string so a user viewing another timezone does
  // not have their computer's timezone silently shift the hourly selection.
  const reference = typeof from === 'string'
    ? from.slice(0, 16)
    : (() => {
        const date = new Date(from);
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      })();

  const start = hourly.time.findIndex((t) => t.slice(0, 16) >= reference);
  const begin = start === -1 ? 0 : start;
  return hourly.time.slice(begin, begin + count).map((time, i) => ({
    time,
    label: time.slice(11, 16),
    temperature: hourly.temperature_2m[begin + i],
    code: hourly.weather_code[begin + i],
    rainChance: hourly.precipitation_probability?.[begin + i] ?? null,
    precipitation: hourly.precipitation?.[begin + i] ?? null,
    wind: hourly.wind_speed_10m?.[begin + i] ?? null,
    windDirection: hourly.wind_direction_10m?.[begin + i] ?? null,
    isDay: hourly.is_day?.[begin + i],
  }));
}

const SNOW = new Set([71, 73, 75, 77, 85, 86]);

/** The rain check: the chance of rain this hour, and the first hour in the next day that
 *  is likely to be wet (half a chance or more, or half a millimetre forecast). `now` is
 *  Open-Meteo's current.time, in the place's own time. */
export function rainOutlook(hourly, now, horizon = 24, likely = 50) {
  const none = { chance: null, next: null };
  if (!hourly?.time?.length || !now) return none;
  const start = hourly.time.findIndex((t) => t.slice(0, 13) >= now.slice(0, 13));
  if (start === -1) return none;
  const chance = (i) => hourly.precipitation_probability?.[i] ?? null;
  for (let i = start; i < Math.min(hourly.time.length, start + horizon); i++) {
    if ((chance(i) ?? 0) >= likely || (hourly.precipitation?.[i] ?? 0) >= 0.5) {
      const time = hourly.time[i];
      return {
        chance: chance(start),
        next: {
          kind: SNOW.has(hourly.weather_code?.[i]) ? 'Snow' : 'Rain',
          at: time.slice(11, 16),
          now: i === start,
          tomorrow: time.slice(0, 10) !== now.slice(0, 10),
          chance: chance(i),
        },
      };
    }
  }
  return { chance: chance(start), next: null };
}

export function outlookText({ next }) {
  if (!next) return 'No rain expected in the next 24 hours.';
  const odds = next.chance == null ? '' : ` (${next.chance}% chance)`;
  if (next.now) return `${next.kind} likely now${odds}.`;
  return `${next.kind} likely from ${next.tomorrow ? 'tomorrow ' : ''}${next.at}${odds}.`;
}

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export function forecastQuery(latitude, longitude, timezone = 'auto') {
  return `${FORECAST_URL}?${new URLSearchParams({
    latitude, longitude, timezone,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day,precipitation,cloud_cover,pressure_msl,visibility',
    hourly: 'temperature_2m,relative_humidity_2m,weather_code,precipitation_probability,precipitation,is_day,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
    forecast_days: '10',
  })}`;
}

export const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export function airQuery(latitude, longitude) {
  return `${AIR_URL}?${new URLSearchParams({ latitude, longitude, timezone: 'auto', current: 'us_aqi,pm2_5,pm10' })}`;
}

/** US EPA Air Quality Index bands. */
export function aqiLevel(aqi) {
  if (aqi == null || Number.isNaN(aqi)) return null;
  const bands = [
    [50, 'Good', 'Air quality is satisfactory.'],
    [100, 'Moderate', 'Unusually sensitive people should limit long outdoor exertion.'],
    [150, 'Unhealthy for sensitive groups', 'Children, older people and anyone with heart or lung disease should take it easier outdoors.'],
    [200, 'Unhealthy', 'Everyone should limit long outdoor exertion.'],
    [300, 'Very unhealthy', 'Avoid long outdoor exertion; sensitive groups stay indoors.'],
  ];
  const [, level, advice] = bands.find(([top]) => Math.round(aqi) <= top) ?? [0, 'Hazardous', 'Everyone should stay indoors.'];
  return { level, advice };
}

const SYNODIC = 29.530588853; // days from new moon to new moon
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

/** The moon's phase on a date: its name, an icon, and how much of it is lit. */
export function moonPhase(date = new Date()) {
  const age = ((((date - NEW_MOON) / 86400000) % SYNODIC) + SYNODIC) % SYNODIC;
  const phases = [
    ['New moon', '🌑'], ['Waxing crescent', '🌒'], ['First quarter', '🌓'], ['Waxing gibbous', '🌔'],
    ['Full moon', '🌕'], ['Waning gibbous', '🌖'], ['Last quarter', '🌗'], ['Waning crescent', '🌘'],
  ];
  const [name, icon] = phases[Math.round((age / SYNODIC) * 8) % 8];
  return { name, icon, lit: Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100), age };
}

/** Pressure over the next three hours: rising, falling or steady (more than 1 hPa counts). */
export function pressureTrend(hourly, now) {
  const start = hourly?.time?.findIndex((t) => t.slice(0, 13) >= String(now).slice(0, 13)) ?? -1;
  const a = hourly?.pressure_msl?.[start];
  const b = hourly?.pressure_msl?.[start + 3];
  if (start === -1 || a == null || b == null) return null;
  return b - a > 1 ? 'Rising' : a - b > 1 ? 'Falling' : 'Steady';
}

export function visibilityNote(meters) {
  if (meters == null) return '';
  if (meters >= 20000) return 'Perfectly clear view.';
  if (meters >= 10000) return 'Clear view.';
  if (meters >= 4000) return 'Haze is softening distant views.';
  if (meters >= 1000) return 'Mist or haze is cutting visibility.';
  return 'Fog: visibility is very poor.';
}

/** Why "feels like" differs from the thermometer, in a sentence. */
export function feelsNote({ temperature_2m: t, apparent_temperature: feels, wind_speed_10m: wind, relative_humidity_2m: humidity }) {
  if (t == null || feels == null) return '';
  const difference = feels - t;
  if (Math.abs(difference) < 1.5) return 'Similar to the actual temperature.';
  if (difference < 0) return wind >= 15 ? 'Wind is making it feel cooler.' : 'It feels cooler than it is.';
  return humidity >= 50 ? 'Humidity is making it feel warmer.' : 'Sunshine is making it feel warmer.';
}

/** Where the sun is between sunrise and sunset, 0 to 1 (null at night), from local "HH:MM" times. */
export function sunProgress(now, sunrise, sunset) {
  const minutes = (time) => (time ? Number(time.slice(-5, -3)) * 60 + Number(time.slice(-2)) : null);
  const [n, rise, set] = [minutes(now), minutes(sunrise), minutes(sunset)];
  if (n == null || rise == null || set == null || set <= rise) return null;
  return n < rise || n > set ? null : (n - rise) / (set - rise);
}

// Names for a spot clicked on the map or found by the browser's location come
// from OpenStreetMap's Nominatim.
export const REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

/** `detail` is Nominatim's zoom: 10 names the city, 14 the neighbourhood, 16 the street,
 *  so a click on a closely zoomed map is named as closely. */
export function reverseQuery(latitude, longitude, detail = 10) {
  return `${REVERSE_URL}?${new URLSearchParams({
    format: 'jsonv2', lat: latitude, lon: longitude,
    zoom: String(Math.min(16, Math.max(8, Math.round(detail)))), 'accept-language': 'en',
  })}`;
}

/** The place Nominatim found at a spot, shaped like a geocoding result; null over open water. */
export function placeFromReverse(body) {
  const a = body?.address;
  if (!a) return null;
  const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality;
  const name = body.name || a.suburb || town || a.county || a.state_district || a.state || a.country;
  if (!name) return null;
  const place = { name };
  // The town for a neighbourhood, otherwise the province or state.
  const within = town && town !== name ? town : a.state;
  if (within && within !== name) place.admin1 = within;
  if (a.country_code) place.country_code = a.country_code.toUpperCase();
  return place;
}

export function placeLabel(place) {
  return [place.name, place.admin1, place.country_code].filter(Boolean).join(', ');
}

/**
 * A place as saved on this device or returned by the geocoder, checked before
 * it reaches a request or the page: finite coordinates in range and short text
 * fields. Anything else gives null, so a damaged save cannot break the page.
 */
export function validPlace(place) {
  if (!place || typeof place !== 'object') return null;
  const latitude = Number(place.latitude), longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const out = { latitude, longitude, name: text(place.name, 120) ?? `${latitude.toFixed(2)}, ${longitude.toFixed(2)}` };
  for (const [key, max] of [['admin1', 80], ['country', 80], ['country_code', 3]]) { const v = text(place[key], max); if (v) out[key] = v; }
  if (place.unnamed === true) out.unnamed = true;
  if (Number.isFinite(place.accuracy) && place.accuracy >= 0) out.accuracy = place.accuracy;
  if (Number.isInteger(place.detail) && place.detail >= 0 && place.detail <= 20) out.detail = place.detail;
  return out;
}

/** Whether a forecast response has what the page draws; partial answers are rejected with a reason. */
export function checkForecast(data) {
  if (!data || typeof data !== 'object') return 'The weather service sent an empty answer.';
  if (data.error) return `The weather service could not give a forecast here${typeof data.reason === 'string' ? ` (${data.reason.slice(0, 120)})` : ''}.`;
  const c = data.current;
  if (!c || typeof c !== 'object' || typeof c.time !== 'string' || !Number.isFinite(c.temperature_2m)) return 'The weather service sent no current conditions for this place.';
  if (!Array.isArray(data.hourly?.time) || !Array.isArray(data.daily?.time)) return 'The weather service sent an incomplete forecast for this place.';
  return null;
}
