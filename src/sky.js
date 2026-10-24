// The world behind the page: a 3D sky showing the weather at the place on screen.
// Its colour follows the time of day, the sun crosses on its arc and the moon shows
// its real phase, clouds gather with the cloud cover and drift with the real wind,
// rain and snow fall as hard as they are falling there, storms flash and poor
// visibility hangs as mist. mood.js decides what to show; this only draws it.
// Without WebGL the page keeps a still gradient in the same mood (index.html).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js';

// [zenith, horizon] for each kind of sky.
const SKIES = {
  clear: ['#163f78', '#8fb8db'],
  cloudy: ['#2f3c4c', '#7d8894'],
  rain: ['#1b232c', '#4a545e'],
  storm: ['#0d1014', '#2c3138'],
  snow: ['#4c5a69', '#b9c3cc'],
  fog: ['#5a6066', '#a6aaad'],
  golden: ['#1b1932', '#d8984f'],
  night: ['#03050b', '#141c2e'],
  nightCloudy: ['#050608', '#171b22'],
};
const CLOUDS = 60;
const DROPS = 2400;
const FLAKES = 1400;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function canvasTexture(size, draw, height = size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  draw(c.getContext('2d'), size, height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glow = (inner, outer) => canvasTexture(128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, inner);
  r.addColorStop(0.25, inner);
  r.addColorStop(1, outer);
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
});
// A soft cumulus: overlapping puffs, heavier at the base.
const cloudTexture = (seed) => canvasTexture(256, (g, w, h) => {
  let s = seed;
  const next = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 22; i++) {
    const x = w * (0.18 + next() * 0.64);
    const y = h * (0.42 + next() * 0.3);
    const r = h * (0.16 + next() * 0.24);
    const puff = g.createRadialGradient(x, y, 0, x, y, r);
    puff.addColorStop(0, 'rgba(255,255,255,0.55)');
    puff.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = puff;
    g.fillRect(0, 0, w, h);
  }
}, 128);
/** The moon as it is tonight: lit from the right while waxing, from the left while waning. */
function moonTexture(age) {
  return canvasTexture(128, (g, s) => {
    const image = g.createImageData(s, s);
    const k = Math.cos(2 * Math.PI * age);
    const waxing = age < 0.5;
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        const x = (px + 0.5) / (s / 2) - 1;
        const y = (py + 0.5) / (s / 2) - 1;
        const d = x * x + y * y;
        if (d > 1) continue;
        const edge = Math.sqrt(1 - y * y);
        const lit = waxing ? x > k * edge : x < -k * edge;
        const shade = 0.78 + 0.22 * Math.sqrt(1 - d); // darker towards the rim, as the real one
        const i = (py * s + px) * 4;
        image.data[i] = lit ? 242 * shade : 40;
        image.data[i + 1] = lit ? 236 * shade : 46;
        image.data[i + 2] = lit ? 225 * shade : 60;
        image.data[i + 3] = (lit ? 255 : 70) * Math.min(1, (1 - d) * 14); // soft rim; earthshine on the dark side
      }
    }
    g.putImageData(image, 0, 0);
  });
}

export function createSky(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  let ratio = Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(ratio);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 900);
  camera.rotation.order = 'YXZ';
  scene.fog = new THREE.Fog(0x8fb8db, 200, 900);

  // The dome: a gradient from horizon to zenith, warmed around the sun.
  const uniforms = {
    zenith: { value: new THREE.Color(SKIES.clear[0]) },
    horizon: { value: new THREE.Color(SKIES.clear[1]) },
    sunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    glowColor: { value: new THREE.Color('#f1c27d') },
    glow: { value: 1 },
    flash: { value: 0 },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 glowColor; uniform float glow; uniform float flash;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.5));
        float s = max(dot(vDir, sunDir), 0.0);
        col += glowColor * (pow(s, 32.0) * 0.7 + pow(s, 5.0) * 0.22) * glow;
        col += vec3(0.7, 0.75, 0.9) * flash;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(dome);

  // Stars, faded out by day and behind cloud.
  const starPositions = new Float32Array(1600 * 3);
  for (let i = 0; i < 1600; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = Math.random() ** 0.7;
    const r = Math.sqrt(1 - y * y);
    starPositions.set([Math.cos(a) * r * 420, y * 420 + 10, Math.sin(a) * r * 420], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: 0xf2ece1, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
  }));
  scene.add(stars);

  // The sun, and the moon in tonight's phase.
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow('rgba(255,244,214,1)', 'rgba(255,190,90,0)'), fog: false, depthWrite: false, transparent: true }));
  sun.scale.setScalar(70);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, transparent: true }));
  moon.scale.setScalar(22);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow('rgba(214,220,240,0.35)', 'rgba(214,220,240,0)'), fog: false, depthWrite: false, transparent: true }));
  moonHalo.scale.setScalar(80);
  scene.add(sun, moonHalo, moon);
  let moonAge = -1;

  // Clouds: soft sprites in layers, drifting with the wind and wrapping round.
  const cloudMaps = [cloudTexture(7), cloudTexture(19), cloudTexture(43)];
  const clouds = [];
  for (let i = 0; i < CLOUDS; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudMaps[i % 3], transparent: true, depthWrite: false, opacity: 0 }));
    const width = rand(110, 280);
    sprite.scale.set(width, width * 0.5, 1);
    sprite.position.set(rand(-360, 360), rand(20, 150), rand(-360, -90));
    sprite.userData.depth = rand(0.6, 1.2);
    scene.add(sprite);
    clouds.push(sprite);
  }

  // Rain: short slanted streaks. Snow: soft flakes that sway.
  const dropPositions = new Float32Array(DROPS * 6);
  const drops = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xb8c4d4, transparent: true, opacity: 0.35, depthWrite: false }));
  drops.geometry.setAttribute('position', new THREE.BufferAttribute(dropPositions, 3));
  for (let i = 0; i < DROPS; i++) dropPositions.set([rand(-120, 120), rand(-20, 160), rand(-160, -10)], i * 6);
  drops.frustumCulled = false;
  const flakePositions = new Float32Array(FLAKES * 3);
  for (let i = 0; i < FLAKES; i++) flakePositions.set([rand(-120, 120), rand(-20, 160), rand(-160, -10)], i * 3);
  const flakes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
    map: glow('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), size: 2.4, transparent: true, depthWrite: false, opacity: 0.9,
  }));
  flakes.geometry.setAttribute('position', new THREE.BufferAttribute(flakePositions, 3));
  flakes.frustumCulled = false;
  scene.add(drops, flakes);

  // What the sky is showing, and what it is easing towards.
  const want = { zenith: new THREE.Color(), horizon: new THREE.Color(), cloud: new THREE.Color(), stars: 0, clouds: 0, cloudOpacity: 0.8, rain: 0, snow: 0, fogFar: 900, sun: 1, moon: 0 };
  const now = { zenith: uniforms.zenith.value, horizon: uniforms.horizon.value, cloud: new THREE.Color('#ffffff'), stars: 0, clouds: 0, rain: 0, snow: 0, fogFar: 900, sun: 1, moon: 0 };
  let wind = { x: 0.6 };
  let lightning = false;
  let nextFlash = 0;
  let flash = 0;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let last = 0;
  let slow = 0;
  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; }, { passive: true });

  function place(sprite, progress, height) {
    // Across the view from left (east, morning) to right (west, evening).
    const a = (-60 + progress * 120) * (Math.PI / 180);
    const e = (4 + Math.sin(Math.PI * progress) * height) * (Math.PI / 180);
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    sprite.position.copy(dir).multiplyScalar(400);
    return dir;
  }

  function step(dt, time) {
    const k = reduce ? 1 : 1 - 0.97 ** (dt * 60);
    now.zenith.lerp(want.zenith, k);
    now.horizon.lerp(want.horizon, k);
    now.cloud.lerp(want.cloud, k);
    for (const key of ['stars', 'clouds', 'rain', 'snow', 'fogFar', 'sun', 'moon']) now[key] += (want[key] - now[key]) * k;

    scene.fog.color.copy(now.horizon);
    scene.fog.far = now.fogFar;
    scene.fog.near = Math.min(120, now.fogFar * 0.2);
    stars.material.opacity = now.stars;
    sun.material.opacity = now.sun;
    uniforms.glow.value = Math.max(now.sun, now.moon * 0.25);
    moon.material.opacity = now.moon;
    moonHalo.material.opacity = now.moon;

    const shown = Math.round(now.clouds * CLOUDS);
    clouds.forEach((cloud, i) => {
      cloud.material.opacity = i < shown ? want.cloudOpacity : Math.max(0, cloud.material.opacity - dt);
      cloud.material.color.copy(now.cloud).lerp(new THREE.Color(1, 1, 1), flash * 0.8);
      // Across the view only: wrapping in depth would pop a cloud out of thin air.
      cloud.position.x += wind.x * dt * cloud.userData.depth;
      if (cloud.position.x > 380) cloud.position.x = -380;
      if (cloud.position.x < -380) cloud.position.x = 380;
    });

    // Rain falls fast, leaning with the wind.
    const rainCount = Math.round(now.rain * DROPS);
    drops.geometry.setDrawRange(0, rainCount * 2);
    drops.visible = rainCount > 0;
    if (drops.visible) {
      const lean = wind.x * 0.05;
      for (let i = 0; i < rainCount; i++) {
        const o = i * 6;
        dropPositions[o + 1] -= (90 + (i % 7) * 8) * dt;
        dropPositions[o] += wind.x * dt * 0.6;
        if (dropPositions[o + 1] < -20) { dropPositions[o + 1] = rand(140, 170); dropPositions[o] = rand(-120, 120); }
        dropPositions[o + 3] = dropPositions[o] - lean * 3;
        dropPositions[o + 4] = dropPositions[o + 1] + 3.2;
        dropPositions[o + 5] = dropPositions[o + 2];
      }
      drops.geometry.attributes.position.needsUpdate = true;
    }
    const snowCount = Math.round(now.snow * FLAKES);
    flakes.geometry.setDrawRange(0, snowCount);
    flakes.visible = snowCount > 0;
    if (flakes.visible) {
      for (let i = 0; i < snowCount; i++) {
        const o = i * 3;
        flakePositions[o + 1] -= (7 + (i % 5)) * dt;
        flakePositions[o] += (Math.sin(time * 0.8 + i) * 2 + wind.x * 0.3) * dt;
        if (flakePositions[o + 1] < -20) { flakePositions[o + 1] = rand(140, 170); flakePositions[o] = rand(-120, 120); }
      }
      flakes.geometry.attributes.position.needsUpdate = true;
    }

    // Lightning: a flash and a flicker every few seconds in a storm.
    if (lightning && !reduce && time > nextFlash) { flash = 1; nextFlash = time + rand(3, 9); }
    flash = Math.max(0, flash - dt * (flash > 0.5 ? 6 : 3));
    uniforms.flash.value = flash * 0.55 * (0.7 + 0.3 * Math.sin(time * 90));

    // A little parallax with the pointer and the scroll.
    camera.rotation.y += (-pointer.x * 0.06 - camera.rotation.y) * Math.min(1, dt * 3);
    camera.rotation.x += (0.1 - pointer.y * 0.04 - Math.min(scrollY / innerHeight, 2) * 0.05 - camera.rotation.x) * Math.min(1, dt * 3);
  }

  function frame(t) {
    raf = 0;
    if (document.hidden) return;
    const time = t / 1000;
    const dt = last ? Math.min(0.1, time - last) : 1 / 60;
    last = time;
    // Steps down in resolution on a device that cannot keep up.
    slow = dt > 0.045 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 40 && ratio > 0.75) { ratio = Math.max(0.75, ratio - 0.25); renderer.setPixelRatio(ratio); fit(); slow = 0; }
    step(dt, time);
    renderer.render(scene, camera);
    if (!reduce) raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };

  function fit() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    wake();
  }
  addEventListener('resize', fit);
  document.addEventListener('visibilitychange', wake);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
  canvas.addEventListener('webglcontextrestored', wake);
  fit();

  return {
    /** Show a mood from mood.js; `moon` is moonPhase() from weather.js. */
    set(mood, moonPhase) {
      const palette = mood.night
        ? (mood.clouds > 0.6 || mood.rain || mood.snow ? SKIES.nightCloudy : SKIES.night)
        : mood.golden && !mood.rain && !mood.snow && mood.mood !== 'fog' ? SKIES.golden : SKIES[mood.mood];
      want.zenith.set(palette[0]);
      want.horizon.set(palette[1]);
      want.cloud.set(mood.night ? '#2a3140' : mood.golden ? '#e7a988' : mood.mood === 'storm' ? '#545a63'
        : mood.mood === 'rain' ? '#8a939d' : mood.mood === 'cloudy' ? '#d9dee3' : '#ffffff');
      want.cloudOpacity = mood.night ? 0.55 : mood.golden ? 0.7 : 0.85;
      want.clouds = Math.max(mood.clouds, mood.mood === 'fog' ? 0.6 : 0);
      want.stars = mood.night ? 1 - mood.clouds * 0.9 : 0;
      want.rain = mood.rain;
      want.snow = mood.snow;
      want.fogFar = 900 - mood.fog * 720;
      want.sun = !mood.night && mood.sun != null ? Math.max(0.15, 1 - mood.clouds * 0.85) : 0;
      want.moon = mood.night && moonPhase ? Math.max(0.2, 1 - mood.clouds * 0.8) : 0;
      if (mood.sun != null) uniforms.sunDir.value.copy(place(sun, mood.sun, 18));
      uniforms.glowColor.value.set(mood.golden ? '#f0a95a' : '#f6e2b0');
      if (mood.night) {
        uniforms.sunDir.value.copy(place(moon, 0.72, 14));
        moonHalo.position.copy(moon.position);
        if (moonPhase && Math.abs(moonPhase.age - moonAge) > 0.2) {
          moonAge = moonPhase.age;
          moon.material.map?.dispose();
          moon.material.map = moonTexture(moonPhase.age / 29.530588853);
          moon.material.needsUpdate = true;
        }
      }
      // The wind blows towards the opposite of where it is named from; 20 km/h moves clouds about 5 units a second.
      const toward = ((mood.wind.direction + 180) * Math.PI) / 180;
      const speed = Math.max(1.5, mood.wind.speed * 0.25);
      wind = { x: Math.sin(toward) * speed };
      lightning = mood.lightning;
      wake();
    },
  };
}
