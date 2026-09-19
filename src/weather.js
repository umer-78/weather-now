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

export function describeCode(code) {
  const [text, icon] = CODES[code] ?? ['Unknown', '❓'];
  return { text, icon };
}

export const toFahrenheit = (celsius) => (celsius * 9) / 5 + 32;

export function formatTemperature(celsius, unit = 'c') {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return '—';
  const value = unit === 'f' ? toFahrenheit(celsius) : celsius;
  return `${Math.round(value)}°${unit.toUpperCase()}`;
}

/** Compass point from a bearing in degrees. */
export function windDirection(degrees) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** UV index bands, as published by the WHO. */
export function uvAdvice(index) {
  if (index === null || index === undefined) return { level: 'unknown', advice: '' };
  if (index < 3) return { level: 'low', advice: 'No protection needed.' };
  if (index < 6) return { level: 'moderate', advice: 'Wear sunglasses; use sunscreen at midday.' };
  if (index < 8) return { level: 'high', advice: 'Sunscreen, hat, shade between 11am and 4pm.' };
  if (index < 11) return { level: 'very high', advice: 'Avoid the sun between 11am and 4pm.' };
  return { level: 'extreme', advice: 'Stay indoors around midday.' };
}

/** "Feels like" is already provided by the API; this is the wind-chill side of
 *  it, kept for the explanation panel. */
export function windChill(celsius, windKph) {
  if (celsius > 10 || windKph < 4.8) return celsius;
  return 13.12 + 0.6215 * celsius - 11.37 * windKph ** 0.16 + 0.3965 * celsius * windKph ** 0.16;
}

export function summarise(current) {
  const { text } = describeCode(current.weather_code);
  const feels = Math.round(current.apparent_temperature);
  const actual = Math.round(current.temperature_2m);
  const difference = feels - actual;
  if (Math.abs(difference) >= 3) {
    return `${text}, ${actual}° but feels like ${feels}°.`;
  }
  return `${text}, ${actual}°.`;
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
  }));
}

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export function forecastQuery(latitude, longitude, timezone = 'auto') {
  return `${FORECAST_URL}?${new URLSearchParams({
    latitude, longitude, timezone,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
    forecast_days: '7',
  })}`;
}

export function placeLabel(place) {
  return [place.name, place.admin1, place.country_code].filter(Boolean).join(', ');
}
