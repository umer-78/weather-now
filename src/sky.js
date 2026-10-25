// The world behind the page: the sky over the place on screen, drawn as it really
// looks, and seen as if through a window. The sky itself is three.js's physically
// based model of sunlight scattering in the air (Preetham), so the blue, the haze and
// a sunset's reds come from the sun's real height there, worked out from the latitude,
// the date and the minute; the sun crosses the view as the day goes on, sinks through
// a long dusk, and the moon rises and sets on its own hours in its real phase. The
// cloud layer is lit from the sun, thickens with the measured cover and drifts with
// the real wind, pushed on by its gusts. Rain falls at the measured rate and leans
// with the wind, beading and running down the glass; snow drifts and settles on the
// hills; storms throw lightning; poor visibility hangs as haze over distant hills.
// The temperature shows too: a hot day hazes the air and shimmers, a freezing one
// frosts the window. mood.js decides what to show; this only draws it.
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
const clamp01 = (v) => Math.max(0, Math.min(1, v));

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

// three.js's sky drifts its clouds one fixed way at one speed; this one carries them
// on the wind (an offset that builds up, so a change of wind never jumps them), and
// under a full deck of cloud turns the whole sky the flat grey it really is
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
      .replace('uniform float time;', 'uniform float time;\n\t\tuniform vec2 cloudOffset;\n\t\tuniform float overcast;\n\t\tuniform float gloom;')
      .replace(drift, 'cloudUV += cloudOffset;')
      .replace(gaps, 'float threshold = ( 1.0 - cov ) * ( 1.0 - overcast ) - overcast * 0.4;') // an overcast deck has no gaps
      .replace(out, `float lum = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
			texColor = mix( texColor, vec3( lum ) * vec3( 0.94, 0.97, 1.0 ), overcast ) * ( 1.0 - gloom );
			${out}`);
    Object.assign(shader.uniforms, { cloudOffset: { value: new THREE.Vector2() }, overcast: { value: 0 }, gloom: { value: 0 } });
    shader.needsUpdate = true;
  }
  return sky;
}

// The window the sky is seen through. Drawn over the finished picture, it bends it:
// rain beads on the glass and runs down it in trails while the view behind mists
// over, hot air shimmers low over the land, and frost grows in from the edges.
const GLASS = {
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D frame;
    uniform vec2 texel;
    uniform float aspect, time, wet, heat, frost;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    // layered noise, each layer turned so no grid shows; ridged, it draws ice feathers
    const mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = turn * p; a *= 0.5; } return v; }
    float ridged(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * (1.0 - abs(noise(p) * 2.0 - 1.0)); p = turn * p; a *= 0.5; } return v; }
    // how much of a drop of radius r covers a point d from its centre
    float disc(float r, float d) { return r <= 0.0 ? 0.0 : 1.0 - smoothstep(r * 0.7, r, d); }

    // A bead of water in each cell of a grid, forming and drying at its own pace;
    // fewer of them in light rain. Gives the bead's outward direction and its cover.
    vec3 beads(vec2 p, float scale, float t) {
      vec2 g = p * scale;
      vec2 id = floor(g);
      float n = hash(id);
      if (n > wet * 0.85 + 0.08) return vec3(0.0);
      vec2 c = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.5;
      float life = fract(t * (0.025 + 0.05 * hash(id + 5.3)) + n);
      float r = mix(0.1, 0.28, hash(id + 1.3)) * smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.75, 1.0, life));
      vec2 d = fract(g) - 0.5 - c;
      d.y *= 1.2; // water sits a little flattened on glass
      float m = disc(r, length(d));
      return vec3(d / max(r, 1e-3) * m, m);
    }

    // Drops heavy enough to run: one down each column of the glass, wandering a little,
    // leaving a trail of small beads and a clearer streak behind it.
    vec4 runs(vec2 p, float t) {
      float w = 0.085;
      float col = floor(p.x / w);
      float n = hash(vec2(col, 4.2));
      if (n > wet * 0.8) return vec4(0.0);
      float speed = 0.05 + 0.12 * hash(vec2(col, 9.1));
      float head = 1.25 - fract(t * speed + n) * 1.6;
      float path = sin(p.y * 21.0 + n * 6.28) * 0.012 + sin(p.y * 7.0 + n * 3.0) * 0.008;
      float x = (fract(p.x / w) - 0.5) * w - path;
      float r = 0.012 + 0.008 * hash(vec2(col, 2.7));
      vec2 d = vec2(x, (p.y - head) * 0.72);
      float m = disc(r, length(d));
      vec2 bend = d / r * m;
      float above = p.y - head;
      float fade = step(0.0, above) * exp(-above * 4.0);
      float ty = (fract(above / 0.028) - 0.5) * 0.028;
      float rt = 0.0045 * fade * step(0.4, hash(vec2(col, floor(above / 0.028))));
      float mt = disc(rt, length(vec2(x, ty)));
      bend += vec2(x, ty) / max(rt, 1e-3) * mt;
      float streak = smoothstep(r, 0.0, abs(x)) * step(0.0, above) * exp(-above * 1.2);
      return vec4(bend, max(m, mt), streak);
    }

    void main() {
      vec2 uv = vUv;
      vec2 p = vec2(uv.x * aspect, uv.y);
      vec2 bend = vec2(0.0);
      float cover = 0.0;
      float clear = 0.0;
      float lip = 0.0;
      if (wet > 0.0) {
        vec3 a = beads(p, 30.0, time);
        vec3 b = beads(p + 7.3, 16.0, time * 0.8);
        vec4 c = runs(p, time);
        // a drop is a tiny lens: it shows the world beyond it upside down
        bend -= (a.xy / 30.0 * 2.6 + b.xy / 16.0 * 2.6) * vec2(1.0 / aspect, 1.0);
        bend -= c.xy * 0.03 * vec2(1.0 / aspect, 1.0);
        cover = max(max(a.z, b.z), c.z);
        lip = -(a.y + b.y + c.y * 0.6);
        clear = c.w;
      }
      if (heat > 0.0) {
        float low = 1.0 - smoothstep(0.05, 0.7, uv.y);
        bend += vec2(sin(uv.y * 140.0 + time * 4.0 + sin(uv.x * 26.0 + time) * 1.5), cos(uv.x * 80.0 - time * 3.2 + uv.y * 30.0)) * 0.0018 * heat * low;
      }
      // Frost grows in from the corners and edges, further the colder it is, in feathers.
      float ice = 0.0;
      float rimed = 0.0;
      if (frost > 0.0) {
        vec2 e = abs(uv - 0.5) * 2.0;
        float edge = pow(pow(e.x, 4.0) + pow(e.y, 4.0), 0.25);
        float reach = 1.08 - frost * 0.4;
        rimed = smoothstep(reach, reach + 0.18, edge + (fbm(p * 5.0) - 0.5) * 0.45);
        float feathers = ridged(p * 16.0 + fbm(p * 3.0) * 2.5);
        ice = rimed * (0.35 + 0.65 * smoothstep(0.5, 0.82, feathers));
        bend += (vec2(fbm(p * 40.0), fbm(p * 40.0 + 9.0)) - 0.5) * 0.014 * rimed;
      }
      vec3 color = texture2D(frame, uv + bend).rgb;
      if (wet > 0.0 || rimed > 0.0) {
        vec2 s = texel * 3.5;
        vec3 soft = (texture2D(frame, uv + bend + vec2(s.x, s.y)).rgb + texture2D(frame, uv + bend + vec2(-s.x, s.y)).rgb
          + texture2D(frame, uv + bend + vec2(s.x, -s.y)).rgb + texture2D(frame, uv + bend - s).rgb) * 0.25;
        color = mix(color, soft * 0.97, max(wet * 0.75 * (1.0 - cover) * (1.0 - clear * 0.8), rimed));
      }
      if (wet > 0.0) {
        // light gathers in the bottom of each drop; its rim is darker
        color += cover * 0.025 + max(lip, 0.0) * 0.05;
        color *= 1.0 - cover * (1.0 - cover) * 0.5;
      }
      if (ice > 0.0) {
        float glint = hash(floor(p * 300.0));
        float sparkle = step(0.994, glint) * (0.5 + 0.5 * sin(time * 2.0 + glint * 40.0));
        vec3 rime = vec3(0.86, 0.91, 0.96) * (0.8 + 0.2 * fbm(p * 30.0)) + sparkle * 0.4;
        color = mix(color, rime, ice * 0.7);
      }
      gl_FragColor = vec4(color, 1.0);
    }`,
};

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
const GOLDEN = { turbidity: 5, rayleigh: 2.6, mie: 0.005, g: 0.86 };
// Colour of the far air: what the hills fade into and the haze is made of.
const NIGHT_HILL = new THREE.Color('#07090d'); // the near hills, dark against the sky
const SNOW_HILL = new THREE.Color('#dfe5ec');
const HAZE = { day: '#a9bccd', golden: '#9a7f86', night: '#0c121c', storm: '#3b414a', rain: '#5a646e', snow: '#c3cbd3', fog: '#a7adb2', hot: '#cdb89a' };
// Below the horizon, the sky model goes dark within two degrees; dusk really lasts
// until the sun is twelve or more down, so its depth is eased into that range.
const DUSK = 0.125;

export function createSky(canvas) {
  // alpha keeps the drawing buffer RGBA, so the glass can copy it on any GPU; the sky is opaque.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
  let ratio = Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.3;
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
  for (let i = 0; i < STARS; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.04 + Math.random() ** 0.8 * 0.96;
    const r = Math.sqrt(1 - y * y);
    starPositions.set([Math.cos(a) * r * FAR, y * FAR, Math.sin(a) * r * FAR], i * 3);
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

  // Rain: fine streaks leaning with the wind.
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

  // The window: the finished picture, copied and redrawn through the glass.
  const glassUniforms = {
    frame: { value: null }, texel: { value: new THREE.Vector2() }, aspect: { value: 1 }, time: { value: 0 }, wet: { value: 0 }, heat: { value: 0 }, frost: { value: 0 },
  };
  const glassScene = new THREE.Scene();
  const glassCamera = new THREE.Camera();
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ ...GLASS, uniforms: glassUniforms, depthTest: false, depthWrite: false, toneMapped: false }));
  pane.frustumCulled = false;
  glassScene.add(pane);
  const bufferSize = new THREE.Vector2();
  let frameTexture = null;

  // What the sky shows, and what it is easing towards. `across` is how far across the
  // view (east, on the left, to west) the sun and the moon are.
  const want = {
    turbidity: 2, rayleigh: 1.2, mie: 0.003, g: 0.86, coverage: 0.2, density: 0.35, cloudElevation: 0.5, exposure: 0.3, overcast: 0, gloom: 0,
    elevation: 30, across: 0.5, stars: 0, moon: 0, moonAcross: 0.7, moonElevation: 25, rain: 0, snow: 0, settled: 0, haze: 0,
    wet: 0, heat: 0, frost: 0, hazeColor: new THREE.Color(HAZE.day),
  };
  const now = { ...want, hazeColor: new THREE.Color(HAZE.day) };
  let wind = { direction: new THREE.Vector2(1, 0), speed: 3, gusts: 3 };
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

  /** The compass bearing, from straight ahead, of a point `across` (0 to 1) the view. */
  const bearing = (across) => Math.atan((across * 2 - 1) * Math.tan(Math.atan(Math.tan((camera.fov / 2) * RAD) * camera.aspect)));
  const sunVector = new THREE.Vector3();
  const tint = new THREE.Color();
  const snowy = new THREE.Color();
  function step(dt, t) {
    const k = reduce ? 1 : 1 - 0.965 ** (dt * 60);
    for (const key of Object.keys(want)) if (key !== 'hazeColor') now[key] = lerp(now[key], want[key], k);
    now.hazeColor.lerp(want.hazeColor, k);
    if (!reduce) time += dt;

    // The sun: its real height (eased below the horizon into a long dusk), and across
    // the view from east (left) in the morning to west (right) in the evening.
    const height = now.elevation >= 0 ? now.elevation : now.elevation * DUSK;
    sunVector.setFromSphericalCoords(1, (90 - height) * RAD, Math.PI - bearing(now.across));
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
    u.cloudSpeed.value = 0.00002; // how fast the clouds change shape

    // The wind comes in gusts: it rises towards their strength now and then, and the
    // clouds and the rain go with it.
    const gust = reduce ? 0 : Math.max(0, Math.sin(t * 0.9) * Math.sin(t * 0.37 + 2));
    const speed = wind.speed + (wind.gusts - wind.speed) * gust;
    if (u.cloudOffset) u.cloudOffset.value.addScaledVector(wind.direction, (0.000004 + speed * 0.0000012) * (reduce ? 0 : dt));
    u.time.value = time;
    const sideways = -wind.direction.x * Math.min(1.5, speed / 15); // −x is east on screen

    // Lightning: a flash that lights the whole sky, a bolt, and a flicker after.
    if (lightning && !reduce && t > nextFlash) { flash = 1; nextFlash = t + rand(3, 8); strike(); }
    flash = Math.max(0, flash - dt * (flash > 0.5 ? 5 : 2.5));
    const flicker = flash * (0.75 + 0.25 * Math.sin(t * 80));
    renderer.toneMappingExposure = now.exposure * (1 + flicker * 3.5);
    bolt.material.opacity = flash > 0.35 ? flicker : 0;

    stars.material.opacity = now.stars;
    moon.material.opacity = now.moon;
    halo.material.opacity = now.moon;
    moon.position.setFromSphericalCoords(FAR, (90 - now.moonElevation) * RAD, Math.PI - bearing(now.moonAcross));
    halo.position.copy(moon.position);
    hazeUniforms.amount.value = now.haze;
    hazeUniforms.color.value.copy(now.hazeColor);
    scene.fog.color.copy(now.hazeColor);
    scene.fog.far = lerp(5000, 1600, now.haze);
    for (const hill of hills) {
      tint.copy(NIGHT_HILL).lerp(now.hazeColor, hill.userData.shade);
      // snow lies on the hills, lit as the sky is lit
      snowy.copy(tint).lerp(SNOW_HILL, 0.8).multiplyScalar(lerp(1, 0.18, clamp01(-now.elevation / 10)));
      hill.material.color.copy(tint).lerp(snowy, now.settled);
    }

    // Rain falls fast; the streaks lean with the wind.
    const rainCount = Math.round(now.rain * DROPS);
    drops.geometry.setDrawRange(0, rainCount * 2);
    drops.visible = rainCount > 0;
    if (drops.visible) {
      const lean = sideways * 0.9;
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
        flakePositions[o] += (Math.sin(t * 0.7 + i) * 2.4 + sideways * 1.5) * dt;
        if (flakePositions[o + 1] < -40) { flakePositions[o + 1] = rand(160, 190); flakePositions[o] = rand(-140, 140); }
        if (flakePositions[o] > 150) flakePositions[o] -= 290;
        if (flakePositions[o] < -150) flakePositions[o] += 290;
      }
      flakes.geometry.attributes.position.needsUpdate = true;
    }

    glassUniforms.time.value = time;
    glassUniforms.wet.value = now.wet;
    glassUniforms.heat.value = now.heat;
    glassUniforms.frost.value = now.frost;

    // A little parallax with the pointer and the scroll, and a slow look around.
    const wander = reduce ? 0 : Math.sin(t * 0.045) * 0.03;
    camera.rotation.y += (-pointer.x * 0.05 + wander - camera.rotation.y) * Math.min(1, dt * 3);
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
    // Through the glass only when there is something on it.
    if (frameTexture && (now.wet > 0.01 || now.heat > 0.01 || now.frost > 0.01)) {
      renderer.copyFramebufferToTexture(frameTexture);
      renderer.render(glassScene, glassCamera);
    }
    if (!reduce) raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };

  function fit() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(bufferSize);
    frameTexture?.dispose();
    frameTexture = new THREE.FramebufferTexture(bufferSize.x, bufferSize.y);
    glassUniforms.frame.value = frameTexture;
    glassUniforms.texel.value.set(1 / bufferSize.x, 1 / bufferSize.y);
    glassUniforms.aspect.value = camera.aspect;
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
      want.overcast = Math.max(look.overcast, clamp01((mood.clouds - 0.65) / 0.3) * 0.85);
      // Thin wisps even on a clear day; a full deck when it is overcast or wet.
      want.coverage = Math.min(1, Math.max(mood.clouds * 0.92, mood.rain || mood.snow ? 0.9 : 0.04));
      want.exposure = look.exposure;

      // The sun: by day as high as it stands; at night as far below as it has sunk.
      const elevation = mood.elevation ?? (mood.night ? -18 : 25);
      const dusk = mood.night ? clamp01(-elevation / 12) : 0; // 0 at sunset, 1 once it is dark
      want.elevation = mood.night ? Math.min(-0.5, elevation) : Math.max(1.5, elevation);
      want.across = mood.night ? (mood.east ? 0.1 : 0.9) : 0.1 + (mood.sun ?? 0.5) * 0.8;
      const clearish = !mood.rain && !mood.snow && mood.mood !== 'fog';
      const golden = clearish && (mood.golden || (mood.night && dusk < 0.75));
      if (golden) Object.assign(want, GOLDEN, { exposure: lerp(0.4, 0.32, dusk) });
      else if (mood.night) want.exposure = 0.32;

      // The temperature: a hot day is hazy and glaring, a freezing one crisp and clear,
      // and damp air is a little hazier than dry.
      if (!mood.night && clearish) {
        want.turbidity = Math.max(1.6, want.turbidity * (1 - mood.frost * 0.3) + mood.heat * 2 + (mood.humidity - 0.5) * 1.5);
        want.mie *= 1 + mood.heat * 0.6;
      }
      want.heat = mood.night || !clearish ? 0 : mood.heat;
      want.frost = mood.frost;
      want.wet = mood.rain ? clamp01(0.35 + mood.rain * 0.65) : 0;

      // Stars come out as the dusk deepens; the moon shows when it is up.
      const open = Math.max(0, 1 - mood.clouds * 1.1);
      want.stars = mood.night ? clamp01((-elevation - 6) / 8) * open : 0;
      const moonUp = mood.night && moonPhase && mood.moon;
      want.moon = moonUp ? Math.max(0.15, 1 - mood.clouds * 0.9) * clamp01((-elevation - 2) / 4) : 0;
      if (mood.moon) {
        want.moonAcross = 0.12 + mood.moon.progress * 0.76;
        want.moonElevation = Math.max(4, Math.min(36, mood.moon.elevation ?? 25)); // kept in the view
      }
      if (moonPhase && Math.abs(moonPhase.age - moonAge) > 0.2) {
        moonAge = moonPhase.age;
        moon.material.map?.dispose();
        moon.material.map = moonTexture(moonPhase.age / 29.530588853);
        moon.material.needsUpdate = true;
      }

      want.rain = mood.rain;
      want.snow = mood.snow;
      want.settled = mood.snow ? 1 : mood.frost > 0.6 ? 0.4 : 0;
      want.haze = Math.min(0.85, mood.fog * 0.95 + (mood.rain ? 0.12 : 0) + (want.heat ? mood.heat * 0.15 : 0));
      const air = HAZE[mood.mood] ?? HAZE.day;
      want.hazeColor.set(golden ? HAZE.golden : air);
      if (want.heat) want.hazeColor.lerp(tint.set(HAZE.hot), mood.heat * 0.5);
      if (mood.night) want.hazeColor.lerp(tint.set(HAZE.night), golden ? dusk : 1);

      // The wind is named for where it comes from; clouds and rain go the other way.
      // Facing south: east is to the left (−x), north behind (+z).
      const toward = ((mood.wind.direction + 180) % 360) * RAD;
      wind = {
        direction: new THREE.Vector2(Math.sin(toward), -Math.cos(toward)),
        speed: Math.max(3, mood.wind.speed),
        gusts: Math.max(3, mood.wind.gusts ?? mood.wind.speed),
      };
      lightning = mood.lightning;
      wake();
    },
  };
}
