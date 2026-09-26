# Weather Now

[![CI](https://github.com/umer-78/weather-now/actions/workflows/ci.yml/badge.svg)](https://github.com/umer-78/weather-now/actions/workflows/ci.yml)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-f7df1e)
![No API key](https://img.shields.io/badge/API%20key-not%20required-brightgreen)
![License](https://img.shields.io/badge/license-MIT-green)

**Live:** https://umer-78.github.io/weather-now/

Current conditions, the next twelve hours and a seven-day forecast, from
[Open-Meteo](https://open-meteo.com/) — which needs no API key and no sign-up.
No framework, no build step, no tracking.

![Screenshot](docs/screenshot.png)

<sub>Screenshot rendered with a fixed sample response so it looks the same every time.</sub>

## Features

- City search with disambiguation (three Lahores? pick the right one) and
  "use my location" through the browser's geolocation
- Feels-like, humidity, **dew point with a comfort level**, wind speed **and compass direction**, rain, UV with the
  WHO advice band, sunrise and sunset
- Hourly strip that starts from **now**, not from midnight, with night-time icons after dark
- **Precipitation**: chance and amount (mm) now, for each hour and for each day
- Seven-day forecast whose range bars share **one scale**, so days compare at a glance
- **3D world map**: drag the globe, click anywhere for the weather at that spot; the
  marker and coordinates show exactly where the forecast is for
- Stays current: an open tab reloads once its data is 15 minutes old, and shows when it was updated
- °C / °F toggle, remembered along with your last place
- Light and dark theme, and a layout that works on a phone

## What is tested

`src/weather.js` holds the logic with no DOM in it, so it can be tested with
Node's runner:

```bash
node --test      # 19 tests
```

Covering the WMO weather-code table, temperature conversion and rounding,
compass directions across all four quadrants and negative bearings, UV bands,
wind chill only applying when it is cold and windy, the "feels like" phrasing
rule (in °C and °F), night icons, UV bands on the rounded index, precipitation
amounts, range bars on a shared scale, the globe maths (a click maps back to the
same coordinates, and turning brings a place to face you), and — the one that
actually bit — the hourly list starting from the current hour rather than from
the first hour of the day.

## Run it

```bash
git clone https://github.com/umer-78/weather-now.git
cd weather-now
node --test
python3 -m http.server 8080
# open http://localhost:8080
```

## Notes

- Open-Meteo is free for non-commercial use and rate-limited; the page makes one
  forecast call per place, not one per render.
- Geolocation only runs when you press the button, and the coordinates go to
  Open-Meteo and nowhere else.
- The globe's coastlines and borders are Natural Earth (public domain) from the
  `world-atlas` package on jsDelivr, drawn with three.js; without WebGL the map
  card stays hidden and the rest of the page is unchanged.
- `localStorage` is wrapped in try/catch, so private mode degrades to "no saved
  place" instead of a blank page.

## License

[MIT](LICENSE)
