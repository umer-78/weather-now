// The world behind the page: the sky over the place on screen, drawn as it really
// looks. The sky itself is three.js's physically based model of sunlight scattering
// in the air (Preetham), so the blue, the haze and a sunset's reds come from the sun's
// real height there, worked out from the latitude and the date. Its cloud layer is
// lit from the sun, bright on top and grey beneath with silver edges, thickens with
// the measured cover and drifts with the real wind. Rain falls at the measured rate
// and leans with the wind, snow drifts, storms throw lightning, poor visibility hangs
// as haze over distant hills, and at night there are stars and the moon in its real
// phase. mood.js decides what to show; this only draws it.
// Without WebGL the page keeps a still gradient in the same mood (index.html).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const DROPS = 2600;
const FLAKES = 1600;
const STARS = 1800;
const FAR = 300000; // stars and the moon sit just inside the sky box
const RAD = Math.PI / 180;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const lerp = (a, b, k) => a + (b - a) * k;

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glow = (inner, outer) => canvasTexture(128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, inner);
  r.addColorStop(0.3, inner);
  r.addColorStop(1, outer);
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
});
/** The moon as it is tonight: lit from the right while waxing, from the left while waning. */
function moonTexture(age) {
  return canvasTexture(256, (g, s) => {
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
        // darker towards the rim, with a few soft "seas"
        const seas = 0.9 - 0.12 * Math.max(0, Math.sin(x * 5 + 1) * Math.cos(y * 4 - 0.5));
        const shade = (0.78 + 0.22 * Math.sqrt(1 - d)) * seas;
        const i = (py * s + px) * 4;
        image.data[i] = lit ? 246 * shade : 30;
        image.data[i + 1] = lit ? 241 * shade : 36;
        image.data[i + 2] = lit ? 228 * shade : 52;
        image.data[i + 3] = (lit ? 255 : 60) * Math.min(1, (1 - d) * 24); // earthshine on the dark side
      }
    }
    g.putImageData(image, 0, 0);
  });
}

// three.js's sky drifts its clouds one fixed way; this one drifts them with the wind,
// and under a full deck of cloud turns the whole sky the flat grey it really is
// (overcast), darker still under rain and storm cloud (gloom).
function skyMaterial() {
  const sky = new Sky();
  const shader = sky.material;
  const fragment = Sky.SkyShader.fragmentShader;
  const drift = 'cloudUV += time * cloudSpeed;';
  const out = 'gl_FragColor = vec4( texColor, 1.0 );';
  const gaps = 'float threshold = 1.0 - cov;';
  if (fragment.includes(drift) && fragment.includes(out) && fragment.includes(gaps)) {
    shader.fragmentShader = fragment
      .replace('uniform float time;', 'uniform float time;\n\t\tuniform vec2 windDir;\n\t\tuniform float overcast;\n\t\tuniform float gloom;')
      .replace(drift, 'cloudUV += time * cloudSpeed * windDir;')
      .replace(gaps, 'float threshold = ( 1.0 - cov ) * ( 1.0 - overcast ) - overcast * 0.4;') // an overcast deck has no gaps
      .replace(out, `float lum = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
			texColor = mix( texColor, vec3( lum ) * vec3( 0.94, 0.97, 1.0 ), overcast ) * ( 1.0 - gloom );
			${out}`);
    Object.assign(shader.uniforms, { windDir: { value: new THREE.Vector2(1, 1) }, overcast: { value: 0 }, gloom: { value: 0 } });
    shader.needsUpdate = true;
  }
  return sky;
}

/** A ridge line of distant hills, as a filled silhouette. */
function ridge(seed, width, height, base) {
  let s = seed;
  const next = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const shape = new THREE.Shape();
  const steps = 64;
  const phases = [next() * 6, next() * 6, next() * 6];
  shape.moveTo(-width / 2, base - 400);
  for (let i = 0; i <= steps; i++) {
    const x = -width / 2 + (width * i) / steps;
    const u = i / steps;
    const y = base + height * (0.55 + 0.25 * Math.sin(u * 7 + phases[0]) + 0.14 * Math.sin(u * 17 + phases[1]) + 0.06 * Math.sin(u * 41 + phases[2]));
    shape.lineTo(x, y);
  }
  shape.lineTo(width / 2, base - 400);
  return new THREE.ShapeGeometry(shape);
}

// How each kind of weather looks: the air's clarity, the cloud layer, and how bright it all is.
const LOOKS = {
  clear: { turbidity: 2, rayleigh: 1.2, mie: 0.003, g: 0.86, density: 0.35, elevation: 0.5, exposure: 0.3, overcast: 0, gloom: 0 },
  cloudy: { turbidity: 6, rayleigh: 1, mie: 0.004, g: 0.8, density: 0.55, elevation: 0.55, exposure: 0.3, overcast: 0, gloom: 0.1 },
  rain: { turbidity: 10, rayleigh: 0.6, mie: 0.003, g: 0.6, density: 0.95, elevation: 0.8, exposure: 0.3, overcast: 0.9, gloom: 0.35 },
  storm: { turbidity: 14, rayleigh: 0.4, mie: 0.003, g: 0.55, density: 1, elevation: 0.9, exposure: 0.3, overcast: 0.95, gloom: 0.7 },
  snow: { turbidity: 8, rayleigh: 0.9, mie: 0.004, g: 0.65, density: 0.75, elevation: 0.7, exposure: 0.36, overcast: 0.85, gloom: 0.05 },
  fog: { turbidity: 18, rayleigh: 0.8, mie: 0.01, g: 0.72, density: 0.6, elevation: 0.6, exposure: 0.36, overcast: 0.8, gloom: 0.05 },
};
// Colour of the far air: what the hills fade into and the haze is made of.
const NIGHT_HILL = new THREE.Color('#07090d'); // the near hills, dark against the sky
const HAZE = { day: '#a9bccd', golden: '#9a7f86', night: '#0c121c', storm: '#3b414a', rain: '#5a646e', snow: '#c3cbd3', fog: '#a7adb2' };

export function createSky(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  let ratio = Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 500000);
  camera.rotation.order = 'YXZ';
  scene.fog = new THREE.Fog(0xa9bccd, 300, 4000);

  const sky = skyMaterial();
  sky.scale.setScalar(450000);
  sky.renderOrder = -3;
  scene.add(sky);
  const u = sky.material.uniforms;

  // Stars, and the moon with a soft halo.
  const starPositions = new Float32Array(STARS * 3);
  const starSizes = new Float32Array(STARS);
  for (let i = 0; i < STARS; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.04 + Math.random() ** 0.8 * 0.96;
    const r = Math.sqrt(1 - y * y);
    starPositions.set([Math.cos(a) * r * FAR, y * FAR, Math.sin(a) * r * FAR], i * 3);
    starSizes[i] = Math.random() < 0.08 ? 2.4 : 1.3;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: 0xfff6e6, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, toneMapped: false,
  }));
  stars.renderOrder = -2;
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, transparent: true, toneMapped: false }));
  moon.scale.setScalar(FAR * Math.tan(1.7 * RAD));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow('rgba(210,220,245,0.28)', 'rgba(210,220,245,0)'), fog: false, depthWrite: false, transparent: true, toneMapped: false }));
  halo.scale.setScalar(FAR * Math.tan(9 * RAD));
  moon.renderOrder = halo.renderOrder = -2;
  scene.add(stars, halo, moon);
  let moonAge = -1;

  // Distant hills in three ranges, fading into the air.
  const hills = [
    [ridge(11, 12000, 170, -260), -3600],
    [ridge(29, 9000, 140, -250), -2400],
    [ridge(53, 7000, 110, -240), -1500],
  ].map(([geometry, z], i) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x1b2129, fog: true }));
    mesh.position.z = z;
    mesh.userData.shade = [0.6, 0.42, 0.24][i];
    scene.add(mesh);
    return mesh;
  });

  // Haze over the whole view, thickest low down where the air is longest.
  const hazeUniforms = { color: { value: new THREE.Color(HAZE.day) }, amount: { value: 0 } };
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: hazeUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform vec3 color; uniform float amount; varying vec2 vUv;
      void main() {
        float a = amount * mix(1.0, 0.45, smoothstep(0.0, 1.0, vUv.y));
        gl_FragColor = vec4(color, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  haze.frustumCulled = false;
  haze.renderOrder = 1;
  scene.add(haze);

  // Rain: fine streaks, longer the nearer they are, leaning with the wind.
  const dropPositions = new Float32Array(DROPS * 6);
  const drops = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
    color: 0xc4cfdc, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  }));
  drops.geometry.setAttribute('position', new THREE.BufferAttribute(dropPositions, 3));
  for (let i = 0; i < DROPS; i++) dropPositions.set([rand(-140, 140), rand(-40, 180), rand(-180, -8)], i * 6);
  drops.frustumCulled = false;
  drops.renderOrder = 2;
  // Snow: soft flakes of a few sizes that sway as they fall.
  const flakePositions = new Float32Array(FLAKES * 3);
  for (let i = 0; i < FLAKES; i++) flakePositions.set([rand(-140, 140), rand(-40, 180), rand(-180, -8)], i * 3);
  const flakes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
    map: glow('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), size: 2.6, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  }));
  flakes.geometry.setAttribute('position', new THREE.BufferAttribute(flakePositions, 3));
  flakes.frustumCulled = false;
  flakes.renderOrder = 2;
  // Lightning: a forked bolt from the cloud base, for a moment.
  const bolt = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xeef2ff, transparent: true, opacity: 0, depthTest: false, fog: false, toneMapped: false }));
  bolt.frustumCulled = false;
  bolt.renderOrder = 2;
  scene.add(drops, flakes, bolt);
  function strike() {
    const points = [];
    const fork = (x, y, len, depth) => {
      let px = x;
      let py = y;
      const steps = 10 + Math.floor(Math.random() * 6);
      for (let i = 0; i < steps; i++) {
        const nx = px + rand(-len, len) * 0.5;
        const ny = py - len * rand(0.6, 1.1);
        points.push(px, py, -1800, nx, ny, -1800);
        if (depth < 2 && Math.random() < 0.18) fork(nx, ny, len * 0.6, depth + 1);
        px = nx;
        py = ny;
      }
    };
    fork(rand(-900, 900), 900, 70, 0);
    bolt.geometry.dispose();
    bolt.geometry = new THREE.BufferGeometry();
    bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  }

  // What the sky shows, and what it is easing towards.
  const want = {
    turbidity: 2, rayleigh: 1.2, mie: 0.003, g: 0.86, coverage: 0.2, density: 0.35, cloudElevation: 0.5, exposure: 0.3, overcast: 0, gloom: 0,
    elevation: 30, azimuth: 0, stars: 0, moon: 0, rain: 0, snow: 0, haze: 0, hazeColor: new THREE.Color(HAZE.day),
  };
  const now = { ...want, hazeColor: new THREE.Color(HAZE.day) };
  let wind = { x: -1, speed: 0.00002 };
  let lightning = false;
  let nextFlash = 0;
  let flash = 0;
  let time = 0;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let last = 0;
  let slow = 0;
  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { pointer.x = e.clientX / innerWidth - 0.5; pointer.y = e.clientY / innerHeight - 0.5; }, { passive: true });

  const sunVector = new THREE.Vector3();
  function step(dt, t) {
    const k = reduce ? 1 : 1 - 0.965 ** (dt * 60);
    for (const key of Object.keys(want)) if (key !== 'hazeColor') now[key] = lerp(now[key], want[key], k);
    now.hazeColor.lerp(want.hazeColor, k);

    // The sun's place: its real height, and across the view from east (left) to west (right).
    sunVector.setFromSphericalCoords(1, (90 - now.elevation) * RAD, (180 - now.azimuth) * RAD);
    u.sunPosition.value.copy(sunVector);
    u.turbidity.value = now.turbidity;
    u.rayleigh.value = now.rayleigh;
    u.mieCoefficient.value = now.mie;
    u.mieDirectionalG.value = now.g;
    u.cloudCoverage.value = now.coverage;
    u.cloudDensity.value = now.density;
    u.cloudElevation.value = now.cloudElevation;
    if (u.overcast) { u.overcast.value = now.overcast; u.gloom.value = now.gloom; }
    u.showSunDisc.value = Math.max(0, 1 - now.overcast * 1.6); // no sun through a full deck
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = wind.speed;
    if (!reduce) time += dt;
    u.time.value = time;

    // Lightning: a flash that lights the whole sky, a bolt, and a flicker after.
    if (lightning && !reduce && t > nextFlash) { flash = 1; nextFlash = t + rand(3, 8); strike(); }
    flash = Math.max(0, flash - dt * (flash > 0.5 ? 5 : 2.5));
    const flicker = flash * (0.75 + 0.25 * Math.sin(t * 80));
    renderer.toneMappingExposure = now.exposure * (1 + flicker * 3.5);
    bolt.material.opacity = flash > 0.35 ? flicker : 0;

    stars.material.opacity = now.stars;
    moon.material.opacity = now.moon;
    halo.material.opacity = now.moon;
    hazeUniforms.amount.value = now.haze;
    hazeUniforms.color.value.copy(now.hazeColor);
    scene.fog.color.copy(now.hazeColor);
    scene.fog.far = lerp(5000, 1600, now.haze);
    for (const hill of hills) hill.material.color.copy(NIGHT_HILL).lerp(now.hazeColor, hill.userData.shade);

    // Rain falls fast; the streaks lean with the wind.
    const rainCount = Math.round(now.rain * DROPS);
    drops.geometry.setDrawRange(0, rainCount * 2);
    drops.visible = rainCount > 0;
    if (drops.visible) {
      const lean = wind.x * 0.9;
      for (let i = 0; i < rainCount; i++) {
        const o = i * 6;
        dropPositions[o + 1] -= (110 + (i % 7) * 10) * dt;
        dropPositions[o] += lean * dt * 6;
        if (dropPositions[o + 1] < -40) { dropPositions[o + 1] = rand(160, 190); dropPositions[o] = rand(-140, 140); }
        if (dropPositions[o] > 150) dropPositions[o] -= 290;
        if (dropPositions[o] < -150) dropPositions[o] += 290;
        const length = 3 + (i % 3);
        dropPositions[o + 3] = dropPositions[o] - lean * length * 0.25;
        dropPositions[o + 4] = dropPositions[o + 1] + length;
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
        flakePositions[o + 1] -= (7 + (i % 5) * 1.5) * dt;
        flakePositions[o] += (Math.sin(t * 0.7 + i) * 2.4 + wind.x * 1.5) * dt;
        if (flakePositions[o + 1] < -40) { flakePositions[o + 1] = rand(160, 190); flakePositions[o] = rand(-140, 140); }
      }
      flakes.geometry.attributes.position.needsUpdate = true;
    }

    // A little parallax with the pointer and the scroll.
    camera.rotation.y += (-pointer.x * 0.05 - camera.rotation.y) * Math.min(1, dt * 3);
    camera.rotation.x += (0.3 - pointer.y * 0.035 + Math.min(scrollY / innerHeight, 2) * 0.06 - camera.rotation.x) * Math.min(1, dt * 3);
  }

  function frame(stamp) {
    raf = 0;
    if (document.hidden) return;
    const t = stamp / 1000;
    const dt = last ? Math.min(0.1, t - last) : 1 / 60;
    last = t;
    // Steps down in resolution on a device that cannot keep up.
    slow = dt > 0.045 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 40 && ratio > 0.6) { ratio = Math.max(0.6, ratio - 0.25); renderer.setPixelRatio(ratio); fit(); slow = 0; }
    step(dt, t);
    renderer.render(scene, camera);
    if (!reduce) raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };

  function fit() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    // The moon up on the right, three-quarters across whatever the screen's shape,
    // clear of the place and temperature on the left.
    const half = Math.atan(Math.tan((camera.fov / 2) * RAD) * camera.aspect);
    moon.position.setFromSphericalCoords(FAR, 60 * RAD, Math.PI - Math.atan(0.5 * Math.tan(half)));
    halo.position.copy(moon.position);
    wake();
  }
  addEventListener('resize', fit);
  document.addEventListener('visibilitychange', wake);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
  canvas.addEventListener('webglcontextrestored', wake);
  fit();

  return {
    /** Show a mood from mood.js; `moonPhase` is moonPhase() from weather.js. */
    set(mood, moonPhase) {
      const look = LOOKS[mood.mood] ?? LOOKS.clear;
      Object.assign(want, {
        turbidity: look.turbidity, rayleigh: look.rayleigh, mie: look.mie, g: look.g, density: look.density, cloudElevation: look.elevation, gloom: look.gloom,
      });
      // A sky more than about two-thirds covered reads as overcast: grey, not blue.
      want.overcast = Math.max(look.overcast, Math.min(1, Math.max(0, (mood.clouds - 0.65) / 0.3)) * 0.85);
      // Thin wisps even on a clear day; a full deck when it is overcast or wet.
      want.coverage = Math.min(1, Math.max(mood.clouds * 0.92, mood.rain || mood.snow ? 0.9 : 0.04));
      want.exposure = look.exposure;
      const golden = mood.golden && !mood.rain && !mood.snow;
      if (golden) Object.assign(want, { turbidity: 5, rayleigh: 2.6, mie: 0.008, g: 0.86, exposure: 0.45 });
      if (mood.night) {
        // Below the horizon: the scattered light goes, the stars and moon come out.
        want.elevation = -10;
        want.azimuth = 40;
        want.exposure = 0.32;
      } else {
        want.elevation = Math.max(1.5, mood.elevation ?? 25);
        want.azimuth = -80 + (mood.sun ?? 0.5) * 160;
      }
      want.stars = mood.night ? Math.max(0, 1 - mood.clouds * 1.1) : 0;
      want.moon = mood.night && moonPhase ? Math.max(0.15, 1 - mood.clouds * 0.9) : 0;
      want.rain = mood.rain;
      want.snow = mood.snow;
      want.haze = Math.min(0.85, mood.fog * 0.95 + (mood.rain ? 0.12 : 0));
      want.hazeColor.set(mood.night ? HAZE.night : golden ? HAZE.golden : HAZE[mood.mood] ?? HAZE.day);
      if (mood.night) {
        if (moonPhase && Math.abs(moonPhase.age - moonAge) > 0.2) {
          moonAge = moonPhase.age;
          moon.material.map?.dispose();
          moon.material.map = moonTexture(moonPhase.age / 29.530588853);
          moon.material.needsUpdate = true;
        }
      }
      // The wind is named for where it comes from; clouds and rain go the other way.
      // Facing south: east is to the left (−x), north behind (+z).
      const toward = ((mood.wind.direction + 180) % 360) * RAD;
      const speed = Math.max(3, mood.wind.speed);
      if (u.windDir) u.windDir.value.set(Math.sin(toward), -Math.cos(toward)).normalize();
      wind = { x: -Math.sin(toward) * Math.min(1.5, speed / 15), speed: 0.000004 + speed * 0.0000012 };
      lightning = mood.lightning;
      wake();
    },
  };
}
