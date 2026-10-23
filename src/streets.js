// The street map the globe hands over to when you zoom in past it: OpenStreetMap's own
// map, down to single houses and the name of every town, village and street, drawn by
// Leaflet. Loaded only when first needed.
const LIBRARY = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const LEAVE_AT = 4; // zooming out to here goes back to the globe

function load(tag, attributes) {
  return new Promise((resolve, reject) => {
    const node = Object.assign(document.createElement(tag), attributes);
    node.onload = resolve;
    node.onerror = () => reject(new Error('The street map did not load.'));
    document.head.append(node);
  });
}

export async function createStreets(container, { onPick, onLeave }) {
  if (!window.L) {
    await Promise.all([
      load('link', { rel: 'stylesheet', href: `${LIBRARY}leaflet.css` }),
      load('script', { src: `${LIBRARY}leaflet.js` }),
    ]);
  }
  const L = window.L;
  const box = document.createElement('div');
  box.className = 'streets';
  box.hidden = true;
  container.append(box);

  const map = L.map(box, { zoomControl: false, minZoom: LEAVE_AT, maxZoom: 19, worldCopyJump: true });
  L.tileLayer(TILES, {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ position: 'bottomleft' }).addTo(map);

  let shown = null;
  const Buttons = L.Control.extend({
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar streets-buttons');
      bar.innerHTML = `
        <a href="#" role="button" data-act="home" title="Back to the place shown" aria-label="Back to the place shown">◎</a>
        <a href="#" role="button" data-act="globe" title="Back to the globe" aria-label="Back to the globe">🌐</a>`;
      L.DomEvent.disableClickPropagation(bar);
      bar.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        e.preventDefault();
        if (act === 'globe') onLeave(map.getCenter().wrap());
        else if (shown) map.setView(shown, Math.max(map.getZoom(), 13));
      });
      return bar;
    },
  });
  new Buttons({ position: 'topright' }).addTo(map);

  // The pin: the place's name and temperature over an orange dot, as on the globe.
  const pin = L.marker([0, 0], {
    icon: L.divIcon({ className: 'streets-pin', html: '<div><span class="globe-tag"></span><i></i></div>', iconSize: null }),
    interactive: false,
    keyboard: false,
  });
  const tagOf = () => pin.getElement()?.querySelector('.globe-tag');
  let label = '';
  pin.on('add', () => { const tag = tagOf(); if (tag) tag.textContent = label; });

  // A double click zooms; only a single click picks a spot, at the detail the map shows.
  let pending = 0;
  map.on('dblclick', () => clearTimeout(pending));
  map.on('click', (e) => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const round = (value) => Math.round(value * 1e4) / 1e4;
      onPick(round(e.latlng.lat), round(L.Util.wrapNum(e.latlng.lng, [-180, 180], true)), { detail: map.getZoom() });
    }, 250);
  });
  map.on('zoomend', () => { if (!box.hidden && map.getZoom() <= LEAVE_AT) onLeave(map.getCenter().wrap()); });

  return {
    get open() { return !box.hidden; },
    show(latitude, longitude, zoom) {
      box.hidden = false;
      map.invalidateSize();
      map.setView([latitude, longitude], zoom, { animate: false });
    },
    hide() { box.hidden = true; },
    /** The pin on a place; brings it into view unless it was just clicked (follow false). */
    setPlace({ latitude, longitude }, text, follow = true) {
      const moved = !shown || shown[0] !== latitude || shown[1] !== longitude;
      shown = [latitude, longitude];
      pin.setLatLng(shown).addTo(map);
      if (text !== label || moved) { label = text; const tag = tagOf(); if (tag) tag.textContent = text; }
      if (moved && follow && !box.hidden && !map.getBounds().pad(-0.1).contains(shown)) {
        map.setView(shown, Math.max(map.getZoom(), 11));
      }
    },
  };
}
