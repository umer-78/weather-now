// Page behaviour that is not the forecast itself: the header firming up on
// scroll, sections rising into view, and the "Copy link" button. Kept out of
// index.html so the Content-Security-Policy can refuse every inline script.
// The bar firms up once you scroll, and each section rises in as it comes into view.
(() => {
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const io = 'IntersectionObserver' in window && new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px 12% 0px' }); // a panel enters a little before it is reached, as it starts lower and further back
  document.querySelectorAll('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
})();

// share-link: "Copy link" saves this demo's inputs in the URL (?s=...) so the link reopens with the same result.
(() => {
  const FIELDS = ["place"];
  const RUN = "searchForm"; // a button to press after restoring, for pages that do not recompute on input
  const $ = (id) => document.getElementById(id);
  const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
  const value = (f) => (f.type === 'checkbox' ? f.checked : f.value);
  const DEFAULTS = Object.fromEntries(FIELDS.filter((id) => $(id)).map((id) => [id, value($(id))]));
  // Only what differs from the page's own starting values goes in the link, so it stays short.
  const read = () => {
    const o = {};
    for (const id of FIELDS) { const f = $(id); if (f && value(f) !== DEFAULTS[id]) o[id] = value(f); }
    return o;
  };
  const apply = (o) => {
    for (const id of FIELDS) {
      const f = $(id);
      if (!f || !(id in o)) continue;
      if (f.type === 'checkbox') f.checked = !!o[id];
      else if (f.tagName === 'SELECT' && ![...f.options].some((op) => op.value === String(o[id]))) continue;
      else f.value = o[id];
      f.dispatchEvent(new Event('input', { bubbles: true }));
      f.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const run = RUN && $(RUN);
    if (run?.tagName === 'FORM') run.requestSubmit(); else run?.click();
  };
  const show = (url) => {
    document.querySelector('.share-link-out')?.remove();
    const box = document.createElement('div');
    box.className = 'share-link-out';
    box.setAttribute('role', 'status');
    box.innerHTML = '<span>Link copied</span><input readonly aria-label="Shareable link"><button type="button">Close</button>';
    box.querySelector('input').value = url;
    box.querySelector('button').addEventListener('click', () => box.remove());
    document.body.append(box);
    return box;
  };
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn share-link-btn';
  btn.title = 'Copy a link that reopens this demo with your current inputs';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg><span>Copy link</span>';
  btn.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?s=${enc(read())}`;
    btn.dataset.link = url;
    const box = show(url);
    try { await navigator.clipboard.writeText(url); }
    catch { box.querySelector('span').textContent = 'Copy this link:'; box.querySelector('input').select(); }
    if (url.length > 8000) box.querySelector('span').textContent = 'Long link (some apps may cut it):';
  });
  // In the header's action row when it fits; on its own row under the header when it would push the page sideways.
  const actions = document.querySelector('header .actions') || document.querySelector('.actions');
  const row = document.createElement('div');
  row.className = 'share-link-row';
  const place = () => {
    if (!actions) { if (!row.isConnected) { row.append(btn); document.body.prepend(row); } return; }
    if (btn.parentElement !== actions) actions.append(btn);
    if (actions.getBoundingClientRect().right > document.documentElement.clientWidth + 1) {
      row.append(btn);
      (actions.closest('header') || actions).after(row);
    } else row.remove();
  };
  place();
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(place, 150); });
  const s = new URLSearchParams(location.search).get('s');
  if (s) {
    let o = null;
    try { o = dec(s); } catch { /* a damaged link just opens the demo as normal */ }
    if (o && typeof o === 'object') {
      const go = () => setTimeout(() => apply(o), 80);
      if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    }
  }
})();
