// The world map: a 3D globe of real map data, like an online earth viewer. MapLibre GL JS
// draws OpenStreetMap (roads, towns and their names, down to street level, from
// OpenFreeMap) or Sentinel-2 satellite imagery with borders and place names over it.
// Zoom with the scroll wheel, a pinch or the buttons; click anywhere, or on a place
// name, for the weather there. app.js loads this on demand, so without WebGL or the
// CDN the page simply works without a map.
const LIBRARY = 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/';
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const SATELLITE = {
  type: 'raster',
  tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
  tileSize: 256,
  maxzoom: 14, // 10 m imagery; closer in it is enlarged
  attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)',
};
// Over the imagery: borders, water and place names, but not road names floating over hidden roads.
const HIDDEN_ON_SATELLITE = new Set(['poi', 'transportation_name']);
const BROAD = new Set(['continent', 'country', 'state', 'province']);

function load(tag, attributes) {
  return new Promise((resolve, reject) => {
    const node = Object.assign(document.createElement(tag), attributes);
    node.onload = resolve;
    node.onerror = () => reject(new Error('The map library did not load.'));
    document.head.append(node);
  });
}

async function library() {
  if (!window.maplibregl) {
    await Promise.all([
      load('link', { rel: 'stylesheet', href: `${LIBRARY}maplibre-gl.css` }),
      load('script', { src: `${LIBRARY}maplibre-gl.js` }),
    ]);
  }
  if (!window.maplibregl) throw new Error('The map library did not load.');
  return window.maplibregl;
}

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

/** Great-circle distance in degrees. */
function apart([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / r;
}

export async function createGlobe(container, { onPick, center = [74.35, 31.56] }) {
  const maplibregl = await library();
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    center,
    // The whole globe in view to start, on a phone as on a wide screen.
    zoom: Math.min(2.6, Math.max(1, Math.log2((Math.min(container.clientWidth, container.clientHeight) * 1.6 * Math.PI) / 512) || 2)),
    attributionControl: { compact: true },
    // On a phone one finger keeps scrolling the page and two move the map, as embedded maps do.
    cooperativeGestures: matchMedia('(pointer: coarse)').matches,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The map took too long to load.')), 20000);
    map.once('load', () => { clearTimeout(timer); resolve(); });
  });

  let view = read('weather:mapView') === 'map' ? 'map' : 'satellite';
  let satelliteFailures = 0;

  function dress() {
    map.setProjection({ type: 'globe' });
    if (!map.getSource('satellite')) {
      map.addSource('satellite', SATELLITE);
      const layers = map.getStyle().layers;
      const above = layers.find((l) => l['source-layer'] === 'boundary') ?? layers.find((l) => l.type === 'symbol');
      map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-fade-duration': 200 } }, above?.id);
    }
    show(view);
  }

  function show(next, chosen = true) {
    view = next;
    const satellite = view === 'satellite';
    map.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none');
    for (const layer of map.getStyle().layers) {
      if (HIDDEN_ON_SATELLITE.has(layer['source-layer'])) {
        map.setLayoutProperty(layer.id, 'visibility', satellite ? 'none' : 'visible');
      }
    }
    for (const button of switcher.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
    if (chosen) write('weather:mapView', view);
  }

  // Satellite / Map switch, and a button back to the place being shown.
  const switcher = document.createElement('div');
  switcher.className = 'maplibregl-ctrl maplibregl-ctrl-group globe-views';
  switcher.innerHTML = '<button type="button" data-view="satellite">Satellite</button><button type="button" data-view="map">Map</button>';
  switcher.addEventListener('click', (e) => {
    const next = e.target.closest('button')?.dataset.view;
    if (next && next !== view) show(next);
  });
  const home = document.createElement('div');
  home.className = 'maplibregl-ctrl maplibregl-ctrl-group';
  home.innerHTML = '<button type="button" class="globe-home" aria-label="Back to the place shown" title="Back to the place shown">◎</button>';
  home.addEventListener('click', () => {
    if (shown) map.flyTo({ center: shown, zoom: Math.max(map.getZoom(), 9), essential: true });
  });
  const control = (node) => ({ onAdd: () => node, onRemove: () => node.remove() });

  map.addControl(control(switcher), 'top-left');
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(control(home), 'top-right');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
  dress();

  // Imagery that will not load (the service down, or blocked) gives way to the street map.
  map.on('error', (e) => {
    if (e.sourceId === 'satellite' && view === 'satellite' && ++satelliteFailures >= 4) show('map', false);
  });

  // The marker: a pin with the place's name and temperature.
  const pin = document.createElement('div');
  pin.className = 'globe-pin';
  pin.innerHTML = '<span class="globe-tag"></span><span class="globe-dot" aria-hidden="true"></span>';
  const tag = pin.querySelector('.globe-tag');
  const marker = new maplibregl.Marker({ element: pin, anchor: 'bottom' });
  let shown = null;

  // A double click zooms; only a single click picks a spot.
  let pending = 0;
  map.on('dblclick', () => clearTimeout(pending));
  map.on('click', (e) => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const places = map.getStyle().layers.filter((l) => l.type === 'symbol' && l['source-layer'] === 'place').map((l) => l.id);
      const [label] = places.length ? map.queryRenderedFeatures(e.point, { layers: places }) : [];
      const zoom = map.getZoom();
      // Towns and neighbourhoods by name; a country's or state's label is just a spot within it.
      if (label?.geometry?.type === 'Point' && !BROAD.has(label.properties.class)) {
        const p = label.properties;
        const [longitude, latitude] = label.geometry.coordinates.map((value) => Math.round(value * 1e4) / 1e4);
        onPick(latitude, longitude, { name: p['name:en'] ?? p.name_en ?? p['name:latin'] ?? p.name, zoom });
        return;
      }
      const round = (value) => Math.round(value * 1e4) / 1e4;
      onPick(round(e.lngLat.lat), round(e.lngLat.lng), { zoom });
    }, 250);
  });

  return {
    /** Put the pin, tagged with `label`, on a place, and fly there unless it is already in view
     *  (`follow` false: it was just clicked, so it is). */
    setPlace({ latitude, longitude }, label = '', follow = true) {
      tag.textContent = label;
      tag.hidden = !label;
      const at = [longitude, latitude];
      if (shown && shown[0] === longitude && shown[1] === latitude) return;
      shown = at;
      marker.setLngLat(at).addTo(map);
      // Half the view's width in degrees, roughly; the globe's whole face from far out.
      const reach = Math.min(60, (90 * container.clientWidth) / (256 * 2 ** map.getZoom()));
      const { lng, lat } = map.getCenter();
      if (follow && apart([lng, lat], at) > reach * 0.9) {
        map.flyTo({ center: at, zoom: Math.min(Math.max(map.getZoom(), 3), 10), essential: true });
      }
    },
  };
}
