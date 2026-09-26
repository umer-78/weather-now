// Interactive 3D world map: coastlines and borders from Natural Earth (via the
// world-atlas package), a marker on the place being shown, drag to turn it and
// click or tap anywhere for the weather there. app.js loads this on demand, so
// without WebGL or the CDN the page simply works without a map.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js';
import { geoEquirectangular, geoGraticule10, geoPath } from 'https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm';
import { feature, mesh } from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
import { toSphere, fromSphere, facing } from './geo.js';

const WORLD = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
const PALETTE = {
  light: { ocean: '#cfe6f5', land: '#fbfcfd', border: '#aebccc', grid: 'rgba(2, 132, 199, 0.16)' },
  dark: { ocean: '#11283d', land: '#3b485e', border: '#63708a', grid: 'rgba(56, 189, 248, 0.16)' },
};
const MARKER = 0xf97316;
const TILT_LIMIT = 1.3; // radians; keeps the poles from flipping over

export async function createGlobe(container, { onPick }) {
  const response = await fetch(WORLD);
  if (!response.ok) throw new Error(`Map data answered ${response.status}.`);
  const world = await response.json();
  const land = feature(world, world.objects.land);
  const borders = mesh(world, world.objects.countries, (a, b) => a !== b);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.append(renderer.domElement);

  // The map is drawn flat (equirectangular) into a canvas and wrapped round the sphere.
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');
  function paint() {
    const colours = PALETTE[darkScheme.matches ? 'dark' : 'light'];
    const ctx = canvas.getContext('2d');
    const path = geoPath(geoEquirectangular().fitSize([canvas.width, canvas.height], { type: 'Sphere' }), ctx);
    ctx.fillStyle = colours.ocean;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); path(geoGraticule10()); ctx.strokeStyle = colours.grid; ctx.stroke();
    ctx.beginPath(); path(land); ctx.fillStyle = colours.land; ctx.fill();
    ctx.beginPath(); path(borders); ctx.strokeStyle = colours.border; ctx.stroke();
    texture.needsUpdate = true;
  }
  paint();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-3, 2, 4);
  scene.add(sun);

  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshLambertMaterial({ map: texture }));
  globe.rotation.set(0.35, 0, 0);
  scene.add(globe);

  const marker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.042, 48),
    new THREE.MeshBasicMaterial({ color: MARKER, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  marker.add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: MARKER })), ring);
  marker.visible = false;
  globe.add(marker);

  const target = { x: globe.rotation.x, y: globe.rotation.y };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let last = 0;
  let visible = true;

  function frame(now) {
    raf = 0;
    // Time-based, so a slow device finishes the turn as quickly as a fast one.
    const elapsed = last ? Math.min(now - last, 250) : 16;
    last = now;
    const ease = reduce ? 1 : 1 - 0.9 ** (elapsed / 16);
    globe.rotation.x += (target.x - globe.rotation.x) * ease;
    globe.rotation.y += (target.y - globe.rotation.y) * ease;
    const turning = Math.abs(target.x - globe.rotation.x) + Math.abs(target.y - globe.rotation.y) > 1e-4;
    if (!reduce) {
      const phase = (now / 1600) % 1;
      ring.scale.setScalar(1 + phase * 1.6);
      ring.material.opacity = 0.9 * (1 - phase);
    }
    renderer.render(scene, camera);
    if (visible && !document.hidden && (turning || (marker.visible && !reduce))) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function fit() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = 4.4 / Math.min(1, camera.aspect); // step back on narrow screens so the globe fits
    camera.updateProjectionMatrix();
    wake();
  }
  new ResizeObserver(fit).observe(container);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); }).observe(container);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  darkScheme.addEventListener('change', () => { paint(); wake(); });

  // Drag to turn; a press that barely moves is a click on that spot.
  const raycaster = new THREE.Raycaster();
  const el = renderer.domElement;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy) };
    target.y += dx * 0.006;
    target.x = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, target.x + dy * 0.006));
    wake();
  });
  el.addEventListener('pointerup', (e) => {
    if (drag && drag.moved < 6) pick(e);
    drag = null;
  });
  el.addEventListener('pointercancel', () => { drag = null; });

  function pick(e) {
    const rect = el.getBoundingClientRect();
    const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    globe.updateMatrixWorld();
    const [hit] = raycaster.intersectObject(globe, false);
    if (!hit) return;
    const { lat, lon } = fromSphere(globe.worldToLocal(hit.point.clone()));
    onPick(Math.round(lat * 100) / 100, Math.round(lon * 100) / 100);
  }

  let shown = null;
  return {
    /** Put the marker on a place and turn the globe to face it. */
    setPlace({ latitude, longitude }) {
      if (shown && shown.latitude === latitude && shown.longitude === longitude) return;
      shown = { latitude, longitude };
      const p = toSphere(latitude, longitude, 1.004);
      marker.position.set(p.x, p.y, p.z);
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), marker.position.clone().normalize());
      marker.visible = true;
      const turn = facing(latitude, longitude);
      target.x = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, turn.x));
      // Take the short way round rather than unwinding earlier spins.
      const delta = turn.y - globe.rotation.y;
      target.y = globe.rotation.y + delta - 2 * Math.PI * Math.round(delta / (2 * Math.PI));
      wake();
    },
  };
}
