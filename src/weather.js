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

/** Compass point from a bearing in degrees. */
export function windDirection(degrees) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** UV index bands, as published by the WHO. */
export function uvAdvice(index) {
  if (index === null || index === undefined) return { level: 'unknown', advice: '' };
  // The bands are defined on the whole-number index, so 7.6 is 8: very high.
  index = Math.round(index);
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
    isDay: hourly.is_day?.[begin + i],
  }));
}

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export function forecastQuery(latitude, longitude, timezone = 'auto') {
  return `${FORECAST_URL}?${new URLSearchParams({
    latitude, longitude, timezone,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max',
    forecast_days: '7',
  })}`;
}

export function placeLabel(place) {
  return [place.name, place.admin1, place.country_code].filter(Boolean).join(', ');
}
