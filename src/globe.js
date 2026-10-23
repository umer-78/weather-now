// Interactive 3D world map: coastlines and borders from Natural Earth (via the
// world-atlas package), a tagged marker on the place being shown and city names as
// you zoom in. Drag to turn it; scroll, pinch, the buttons or the + and − keys to
// zoom; click or tap anywhere, or on a city's name, for the weather there. Zoom in
// past the globe and it hands over to a street map (streets.js) down to single
// houses; zoom back out of that and the globe returns.
//
// The whole globe is one painted texture, which would blur as you zoom in, so once
// zoomed the stretch of the world in view is painted again at screen resolution and
// laid over the globe: the map stays sharp at every zoom. app.js loads this on
// demand, so without WebGL or the CDN the page simply works without a map.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js';
import { geoEquirectangular, geoGraticule, geoGraticule10, geoPath } from 'https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm';
import { feature, mesh } from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
import { toSphere, fromSphere, facing, viewSpan, patchFrame } from './geo.js';
import { CITIES } from './cities.js';
import { createStreets } from './streets.js';

const ATLAS = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/';
const PALETTE = {
  light: { ocean: '#cfe6f5', land: '#fbfcfd', border: '#aebccc', grid: 'rgba(2, 132, 199, 0.16)' },
  dark: { ocean: '#11283d', land: '#3b485e', border: '#63708a', grid: 'rgba(56, 189, 248, 0.16)' },
};
const MARKER = 0xf97316;
const TILT_LIMIT = 1.3; // radians; keeps the poles from flipping over
const ZOOM_MAX = 12;
const SHARP_FROM = 1.6; // zoom from which the view in front is repainted at screen resolution
const FINE_FROM = 2.5; // zoom from which the finer 1:50m coastlines are fetched
const CITY_ZOOM = { 1: 1.6, 2: 3 }; // zoom at which each tier of city names appears
const RAD = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function atlas(file) {
  const response = await fetch(ATLAS + file);
  if (!response.ok) throw new Error(`Map data answered ${response.status}.`);
  const world = await response.json();
  return { land: feature(world, world.objects.land), borders: mesh(world, world.objects.countries, (a, b) => a !== b) };
}

/** Ocean, graticule, land and borders, drawn through `projection` onto a canvas. */
function draw(canvas, projection, map, colours, line, grid) {
  const ctx = canvas.getContext('2d');
  const path = geoPath(projection, ctx);
  ctx.fillStyle = colours.ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = line;
  ctx.lineJoin = 'round';
  ctx.beginPath(); path(grid); ctx.strokeStyle = colours.grid; ctx.stroke();
  ctx.beginPath(); path(map.land); ctx.fillStyle = colours.land; ctx.fill();
  ctx.beginPath(); path(map.borders); ctx.strokeStyle = colours.border; ctx.stroke();
}

export async function createGlobe(container, { onPick }) {
  let map = await atlas('countries-110m.json');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const el = renderer.domElement;
  el.tabIndex = 0;
  el.setAttribute('role', 'application');
  el.setAttribute('aria-label', 'World map. Arrow keys turn it, plus and minus zoom.');
  container.append(el);

  // The whole world, drawn flat (equirectangular) and wrapped round the sphere.
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const root = document.documentElement;
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');
  // The page's theme button sets data-theme; without it, follow the system.
  const colours = () => PALETTE[(root.dataset.theme ? root.dataset.theme === 'dark' : darkScheme.matches) ? 'dark' : 'light'];
  function paint() {
    draw(canvas, geoEquirectangular().fitSize([canvas.width, canvas.height], { type: 'Sphere' }), map, colours(), 1.5, geoGraticule10());
    texture.needsUpdate = true;
  }
  paint();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-3, 2, 4);
  scene.add(sun);

  const material = new THREE.MeshLambertMaterial({ map: texture });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), material);
  globe.rotation.set(0.35, 0, 0);
  scene.add(globe);

  const marker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.042, 48),
    new THREE.MeshBasicMaterial({ color: MARKER, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  marker.add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: MARKER })), ring);
  marker.visible = false;
  globe.add(marker);

  // Names sit in HTML over the canvas, so they stay crisp at any zoom.
  const overlay = document.createElement('div');
  overlay.className = 'globe-labels';
  overlay.setAttribute('aria-hidden', 'true');
  const tag = document.createElement('div');
  tag.className = 'globe-tag';
  tag.hidden = true;
  const cities = CITIES.map((city) => {
    const label = document.createElement('div');
    label.className = 'globe-city';
    label.textContent = city.name;
    label.hidden = true;
    overlay.append(label);
    return { ...city, label, point: toSphere(city.latitude, city.longitude), box: null };
  });
  overlay.append(tag);
  container.append(overlay);

  const controls = document.createElement('div');
  controls.className = 'globe-controls';
  controls.innerHTML = `
    <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>
    <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out">−</button>
    <button type="button" data-zoom="home" aria-label="Back to the place shown" title="Back to the place shown">◎</button>`;
  container.append(controls);

  const target = { x: globe.rotation.x, y: globe.rotation.y };
  const zoom = { now: 1, target: 1 };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const still = () => reduce || root.classList.contains('fx-still'); // the page's pause-motion button
  let raf = 0;
  let last = 0;
  let visible = true;
  let lost = false;
  let shown = null;
  let wasMoving = false;

  // ── The sharp view: the stretch of the world in front, painted at screen resolution ──
  let fine = 'coarse';
  let patch = null;
  let sharpTimer = 0;
  function sharpenSoon() { clearTimeout(sharpTimer); sharpTimer = setTimeout(sharpen, 120); }
  function dropPatch() {
    if (!patch) return;
    globe.remove(patch);
    patch.geometry.dispose();
    patch.material.map.dispose();
    patch.material.dispose();
    patch = null;
  }
  function sharpen() {
    if (lost || zoom.now < SHARP_FROM) { dropPatch(); return; }
    const width = container.clientWidth;
    const height = container.clientHeight;
    const center = surfaceAt(width / 2, height / 2);
    if (!width || !height || !center) { dropPatch(); return; }
    const samples = [];
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const spot = surfaceAt((width * i) / 8, (height * j) / 8);
        if (spot) samples.push(spot);
      }
    }
    const span = viewSpan(center, samples);
    // About one texel per screen pixel over the view and its margin, within what any GPU takes.
    const ratio = renderer.getPixelRatio();
    const size = Math.min(2048, renderer.capabilities.maxTextureSize);
    const sheet = document.createElement('canvas');
    sheet.width = clamp(Math.round(width * ratio * 1.6), 256, size);
    sheet.height = clamp(Math.round(height * ratio * 1.6), 256, size);
    const frame = patchFrame(span, sheet.width, sheet.height);
    const flat = geoEquirectangular().rotate([-span.lonC, 0]).scale(1).translate([0, 0])
      .clipExtent([[span.lon0 * RAD - 0.01, -span.lat1 * RAD - 0.01], [span.lon1 * RAD + 0.01, -span.lat0 * RAD + 0.01]]);
    const projection = {
      stream: (out) => flat.stream({
        point: (x, y) => { const [px, py] = frame.toPixel(x, y); out.point(px, py); },
        lineStart: () => out.lineStart(),
        lineEnd: () => out.lineEnd(),
        polygonStart: () => out.polygonStart(),
        polygonEnd: () => out.polygonEnd(),
        sphere: () => {},
      }),
    };
    const step = zoom.now >= 6 ? 1 : zoom.now >= 3 ? 5 : 10;
    draw(sheet, projection, map, colours(), 1.4 * ratio, geoGraticule().step([step, step]).precision(1)());

    const sharp = new THREE.CanvasTexture(sheet);
    sharp.colorSpace = THREE.SRGBColorSpace;
    sharp.generateMipmaps = false; // drawn for this zoom, so it is never shrunk far
    sharp.minFilter = THREE.LinearFilter;
    const segments = (degrees) => clamp(Math.ceil(degrees / 1.5), 6, 120); // follows the curve, not a chord under it
    const shape = new THREE.SphereGeometry(1.0006, segments(span.lon1 - span.lon0), segments(span.lat1 - span.lat0),
      frame.phiStart, frame.phiLength, frame.thetaStart, frame.thetaLength);
    dropPatch();
    patch = new THREE.Mesh(shape, new THREE.MeshLambertMaterial({ map: sharp, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    globe.add(patch);
    wake();
  }
  function finer() {
    if (fine !== 'coarse' || zoom.target < FINE_FROM) return;
    fine = 'loading';
    atlas('countries-50m.json')
      .then((detail) => { map = detail; fine = 'fine'; paint(); sharpenSoon(); })
      .catch(() => { fine = 'failed'; }); // the coarse map stays; no retry storm
  }

  // ── Labels ──
  const v = new THREE.Vector3();
  function project(point) {
    v.set(point.x, point.y, point.z).applyMatrix4(globe.matrixWorld);
    // A point on the unit sphere faces a camera at distance d when its z is above 1/d;
    // a margin keeps names off the crowded rim.
    if (v.z < 1 / camera.position.z + 0.08) return null;
    v.project(camera);
    const x = ((v.x + 1) / 2) * container.clientWidth;
    const y = ((1 - v.y) / 2) * container.clientHeight;
    return x < 0 || y < 0 || x > container.clientWidth || y > container.clientHeight ? null : { x, y };
  }
  // Only touch the DOM when a label actually appears or goes.
  const show = (node, on) => { if (node.hidden === !!on) node.hidden = !on; };
  let tagWidth = 0;
  function labels() {
    globe.updateMatrixWorld();
    const taken = [];
    const free = (box) => !taken.some((b) => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top);
    const at = shown && marker.visible ? project(marker.position) : null;
    show(tag, at && tag.textContent);
    if (!tag.hidden) {
      tag.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, calc(-100% - 12px))`;
      tagWidth ||= tag.offsetWidth;
      taken.push({ left: at.x - tagWidth / 2, right: at.x + tagWidth / 2, top: at.y - 40, bottom: at.y + 8 });
    }
    for (const city of cities) {
      city.box = null;
      const near = zoom.now >= CITY_ZOOM[city.tier] && project(city.point);
      // Widths are estimated rather than measured: measuring every frame would force layout.
      const box = near && { left: near.x - 5, right: near.x + 12 + city.name.length * 6.6, top: near.y - 9, bottom: near.y + 9 };
      if (box && free(box)) {
        taken.push(box);
        city.box = box;
        city.label.style.transform = `translate(${near.x}px, ${near.y}px)`;
      }
      show(city.label, city.box);
    }
  }

  // ── Drawing ──
  function frame(now) {
    raf = 0;
    if (lost || deep) return;
    // Time-based, so a slow device finishes the turn as quickly as a fast one.
    const elapsed = last ? Math.min(now - last, 250) : 16;
    last = now;
    const ease = reduce ? 1 : 1 - 0.85 ** (elapsed / 16);
    globe.rotation.x += (target.x - globe.rotation.x) * ease;
    globe.rotation.y += (target.y - globe.rotation.y) * ease;
    zoom.now += (zoom.target - zoom.now) * ease;
    if (Math.abs(zoom.target - zoom.now) < 1e-3) zoom.now = zoom.target;
    camera.zoom = zoom.now;
    camera.updateProjectionMatrix();
    marker.scale.setScalar(1 / zoom.now); // the same size on screen however far in
    const moving = Math.abs(target.x - globe.rotation.x) + Math.abs(target.y - globe.rotation.y) > 1e-4 || zoom.now !== zoom.target;
    const pulsing = marker.visible && !still();
    if (pulsing) {
      const phase = (now / 1600) % 1;
      ring.scale.setScalar(1 + phase * 1.6);
      ring.material.opacity = 0.9 * (1 - phase);
    } else {
      ring.scale.setScalar(1.4);
      ring.material.opacity = 0.6;
    }
    renderer.render(scene, camera);
    labels();
    if (wasMoving && !moving) sharpenSoon(); // the view has settled: paint it sharp
    wasMoving = moving;
    if (visible && !document.hidden && (moving || pulsing)) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  function wake() { if (!raf && !lost && !deep) raf = requestAnimationFrame(frame); }

  // ── Street level: past the globe's last zoom, the street map takes over ──
  let deep = false;
  let streets = null;
  let streetsFailed = false;
  let label = '';
  /** How closely the globe is looked at, on web maps' zoom scale (the whole world is about 2). */
  const webZoom = () => Math.log2((container.clientHeight * zoom.now * 2 * Math.PI)
    / (2 * (camera.position.z - 1) * Math.tan((camera.fov * RAD) / 2) * 256));
  async function deeper(at) {
    if (deep || streetsFailed || container.dataset.loading != null) return;
    const spot = (at && surfaceAt(...at)) || surfaceAt(container.clientWidth / 2, container.clientHeight / 2);
    if (!spot) return;
    container.dataset.loading = '';
    try {
      streets ??= await createStreets(container, {
        onPick: (latitude, longitude, how) => onPick(latitude, longitude, how),
        onLeave: ({ lat, lng }) => leave(lat, lng),
      });
    } catch {
      streetsFailed = true; // the globe carries on as it was
      return;
    } finally {
      delete container.dataset.loading;
    }
    deep = true;
    container.classList.add('deep');
    if (shown) streets.setPlace(shown, label, false);
    streets.show(spot.lat, spot.lon, Math.max(7, Math.round(webZoom()) + 1));
  }
  function leave(latitude, longitude) {
    streets.hide();
    container.classList.remove('deep');
    deep = false;
    // Back on the globe where the street map was, zoomed in, without a turn to watch.
    Object.assign(target, towards(latitude, longitude));
    globe.rotation.set(target.x, target.y, 0);
    zoom.now = zoom.target = ZOOM_MAX * 0.7;
    el.style.touchAction = 'none';
    sharpenSoon();
    wake();
  }

  function fit() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = 4.4 / Math.min(1, camera.aspect); // step back on narrow screens so the globe fits
    camera.updateProjectionMatrix();
    sharpenSoon();
    wake();
  }
  new ResizeObserver(fit).observe(container);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); }).observe(container);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  const repaint = () => { paint(); sharpenSoon(); wake(); };
  darkScheme.addEventListener('change', repaint);
  addEventListener('fx:theme', repaint);
  addEventListener('fx:motion', wake);
  // A phone may take the GPU back under memory pressure; wait, then draw again rather than break.
  el.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    // Its GPU copy went with the context: let it go without disposing into the new one.
    if (patch) { globe.remove(patch); patch = null; }
  });
  // three.js uploads everything again by itself; the sharp view is simply repainted.
  el.addEventListener('webglcontextrestored', () => { lost = false; sharpenSoon(); wake(); });

  /** Rotation that brings a place to the middle, taking the short way round. */
  function towards(latitude, longitude) {
    const turn = facing(latitude, longitude);
    const delta = turn.y - target.y;
    return { x: clamp(turn.x, -TILT_LIMIT, TILT_LIMIT), y: target.y + delta - 2 * Math.PI * Math.round(delta / (2 * Math.PI)) };
  }

  // Exact sphere, not the faceted mesh, so a click lands on the very point under it.
  const raycaster = new THREE.Raycaster();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const hit = new THREE.Vector3();
  /** Latitude and longitude under a point in the map (pixels from its top left), or null off the globe. */
  function surfaceAt(x, y) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), camera);
    if (!raycaster.ray.intersectSphere(sphere, hit)) return null;
    globe.updateMatrixWorld();
    return fromSphere(globe.worldToLocal(hit));
  }
  const local = (e) => { const rect = el.getBoundingClientRect(); return [e.clientX - rect.left, e.clientY - rect.top]; };

  /** Zoom by a factor; zooming in at a point turns the globe so that point stays put. False at the limit. */
  function zoomBy(factor, at) {
    if (factor > 1 && zoom.target >= ZOOM_MAX - 1e-6) { deeper(at); return true; }
    const next = clamp(zoom.target * factor, 1, ZOOM_MAX);
    if (Math.abs(next - zoom.target) < 1e-6) return false;
    const spot = next > zoom.target && at ? surfaceAt(...at) : null;
    if (spot) {
      const turn = towards(spot.lat, spot.lon);
      const share = 1 - zoom.target / next;
      target.x += (turn.x - target.x) * share;
      target.y += (turn.y - target.y) * share;
    }
    zoom.target = next;
    // Zoomed in, one finger moves the map; at the whole-globe view it scrolls the page as before.
    el.style.touchAction = zoom.target > 1.01 ? 'none' : '';
    finer();
    wake();
    return true;
  }

  /** Radians the globe turns per pixel dragged, so the surface follows the pointer at any zoom. */
  const perPixel = () => (2 * camera.position.z * Math.tan((camera.fov * RAD) / 2)) / (zoom.now * (container.clientHeight || 1));

  // Drag to turn, two fingers to pinch; a press that barely moves is a click on that spot.
  const pointers = new Map();
  let drag = null;
  let pinch = 0;
  el.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch { /* the pointer already went */ }
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
    else if (drag) drag.moved = Infinity; // a second finger: never a click
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = el.getBoundingClientRect();
      if (pinch && distance) zoomBy(distance / pinch, [(a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top]);
      pinch = distance;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy) };
    const step = perPixel();
    target.y += dx * step;
    target.x = clamp(target.x + dy * step, -TILT_LIMIT, TILT_LIMIT);
    wake();
  });
  const release = (e, click) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = 0;
    if (pointers.size) {
      // One finger left after a pinch: carry on dragging from where it is now.
      const [rest] = pointers.values();
      drag = { x: rest.x, y: rest.y, moved: Infinity };
      return;
    }
    if (click && drag && drag.moved < 6) pick(...local(e));
    drag = null;
  };
  el.addEventListener('pointerup', (e) => release(e, true));
  el.addEventListener('pointercancel', (e) => release(e, false));
  el.addEventListener('lostpointercapture', (e) => release(e, false));

  el.addEventListener('wheel', (e) => {
    const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? container.clientHeight : 1);
    // A trackpad pinch arrives as a wheel event with ctrlKey and small steps.
    const factor = Math.exp(-clamp(pixels, -240, 240) * (e.ctrlKey ? 0.01 : 0.0025));
    const zoomed = zoomBy(factor, local(e));
    // At the limit the page scrolls on, so the map never traps the scroll.
    if (zoomed || e.ctrlKey) e.preventDefault();
  }, { passive: false });

  el.addEventListener('keydown', (e) => {
    const step = 0.12 / zoom.target;
    const keys = {
      ArrowLeft: () => { target.y -= step; }, ArrowRight: () => { target.y += step; },
      ArrowUp: () => { target.x = clamp(target.x - step, -TILT_LIMIT, TILT_LIMIT); },
      ArrowDown: () => { target.x = clamp(target.x + step, -TILT_LIMIT, TILT_LIMIT); },
      '+': () => zoomBy(1.5), '=': () => zoomBy(1.5), '-': () => zoomBy(1 / 1.5), _: () => zoomBy(1 / 1.5),
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    keys[e.key]();
    wake();
  });

  controls.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.zoom;
    if (action === 'in') zoomBy(2);
    else if (action === 'out') zoomBy(1 / 2);
    else if (action === 'home' && shown) Object.assign(target, towards(shown.latitude, shown.longitude));
    wake();
  });

  function pick(x, y) {
    // A city's name, or near enough to its dot, gives that city by name.
    const city = cities.find(({ box }) => box && x >= box.left - 6 && x <= box.right && y >= box.top - 4 && y <= box.bottom + 4);
    // How closely the map is looked at, on the scale web maps use: the whole globe is about 2.
    const detail = webZoom();
    if (city) {
      onPick(city.latitude, city.longitude, { name: city.name, country_code: city.country_code, detail });
      return;
    }
    const spot = surfaceAt(x, y);
    if (spot) onPick(Math.round(spot.lat * 1e4) / 1e4, Math.round(spot.lon * 1e4) / 1e4, { detail });
  }

  return {
    /** Put the marker, tagged with `label`, on a place and turn the globe to face it. */
    setPlace({ latitude, longitude }, text = '', follow = true) {
      label = text;
      if (tag.textContent !== text) { tag.textContent = text; tagWidth = 0; }
      streets?.setPlace({ latitude, longitude }, text, follow);
      if (!shown || shown.latitude !== latitude || shown.longitude !== longitude) {
        shown = { latitude, longitude };
        const p = toSphere(latitude, longitude, 1.004);
        marker.position.set(p.x, p.y, p.z);
        marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), marker.position.clone().normalize());
        marker.visible = true;
        Object.assign(target, towards(latitude, longitude));
      }
      wake();
    },
  };
}
