// The page's 3D layer, over the 3D sky: panels and tiles tilt towards the pointer
// with a gold glint that follows it round their edge, a tile's contents sit at
// different depths, the hour cards curve round like a carousel as they scroll (or
// are dragged), the place and temperature float in depth with the pointer and the
// scroll, and a gold line at the top tracks how far down the page you are.
// A touch screen keeps the scroll-driven parts; reduced motion gets a still page.
// Anything holding a map stays flat (data-flat), so a click lands where it looks.
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Per frame at most, however fast the events come. */
function throttled(fn) {
  let queued = false;
  let args = [];
  return (...a) => {
    args = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...args); });
  };
}

// ── Tilt and glint ──
if (fine && !reduce) {
  const TILT = { tile: 10, card: 2.4 }; // degrees at the very edge
  let active = null;
  const rest = (el) => {
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.classList.remove('lit');
  };
  const move = throttled((e) => {
    const el = e.target.closest?.('.tile, .card:not([data-flat])');
    if (active && active !== el) rest(active);
    active = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1);
    const y = clamp((e.clientY - r.top) / r.height, 0, 1);
    const max = el.classList.contains('tile') ? TILT.tile : TILT.card;
    el.style.setProperty('--rx', `${((0.5 - y) * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * max).toFixed(2)}deg`);
    el.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    el.classList.add('lit');
  });
  addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerleave', () => { if (active) rest(active); active = null; });
}

// ── The hour cards curve round as the strip scrolls ──
const strip = document.getElementById('hourly');
if (strip && !reduce) {
  const curve = throttled(() => {
    const box = strip.getBoundingClientRect();
    if (!box.width) return;
    const middle = box.left + box.width / 2;
    for (const card of strip.children) {
      const r = card.getBoundingClientRect();
      // -1 at the left edge of the strip, 0 in the middle, 1 at the right edge
      const d = clamp((r.left + r.width / 2 - middle) / (box.width / 2), -1.4, 1.4);
      card.style.setProperty('--cy', `${(-d * 30).toFixed(1)}deg`);
      card.style.setProperty('--cz', `${(-Math.abs(d) * 46).toFixed(1)}px`);
      card.style.setProperty('--co', (1 - Math.max(0, Math.abs(d) - 0.75) * 0.9).toFixed(2));
    }
  });
  strip.addEventListener('scroll', curve, { passive: true });
  addEventListener('resize', curve);
  new MutationObserver(curve).observe(strip, { childList: true });
  curve();

  // With a mouse, drag the strip sideways as you would on a phone.
  if (fine) {
    let drag = null;
    strip.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: strip.scrollLeft, moved: 0 };
    });
    addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.moved = Math.abs(e.clientX - drag.x);
      if (drag.moved > 3) { strip.classList.add('dragging'); strip.scrollLeft = drag.left - (e.clientX - drag.x); }
    }, { passive: true });
    addEventListener('pointerup', () => { drag = null; strip.classList.remove('dragging'); });
  }
}

// ── The hero floats in depth; the gold line tracks the scroll ──
const hero = document.querySelector('.hero');
const bar = document.createElement('div');
bar.className = 'progress';
bar.setAttribute('aria-hidden', 'true');
document.body.append(bar);
const scrolled = throttled(() => {
  const depth = Math.max(1, root.scrollHeight - innerHeight);
  bar.style.transform = `scaleX(${(scrollY / depth).toFixed(4)})`;
  if (!reduce && hero) root.style.setProperty('--hero-scroll', clamp(scrollY / innerHeight, 0, 1).toFixed(3));
});
addEventListener('scroll', scrolled, { passive: true });
addEventListener('resize', scrolled);
scrolled();
if (fine && !reduce && hero) {
  addEventListener('pointermove', throttled((e) => {
    root.style.setProperty('--px', (e.clientX / innerWidth - 0.5).toFixed(3));
    root.style.setProperty('--py', (e.clientY / innerHeight - 0.5).toFixed(3));
  }), { passive: true });
}
