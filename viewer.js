const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const FLUID = { id: 'fluid', name: 'Fluid', w: 600, h: 800, type: 'fluid', fav: true };
const FLUID_MIN = 240;
const FLUID_MAX = 3840;

const DEFAULT_DEVICES = [
  { ...FLUID },
  { id: 'iphone-se', name: 'iPhone SE', w: 375, h: 667, type: 'mobile', fav: true },
  { id: 'iphone-15', name: 'iPhone 15 Pro', w: 393, h: 852, type: 'mobile', fav: true },
  { id: 'iphone-15-max', name: 'iPhone 15 Pro Max', w: 430, h: 932, type: 'mobile', fav: false },
  { id: 'pixel-8', name: 'Pixel 8', w: 412, h: 915, type: 'mobile', fav: false },
  { id: 'galaxy-s23', name: 'Galaxy S23', w: 360, h: 780, type: 'mobile', fav: false },
  { id: 'ipad-mini', name: 'iPad Mini', w: 768, h: 1024, type: 'tablet', fav: true },
  { id: 'ipad-air', name: 'iPad Air', w: 820, h: 1180, type: 'tablet', fav: false },
  { id: 'ipad-pro', name: 'iPad Pro 12.9"', w: 1024, h: 1366, type: 'tablet', fav: false },
  { id: 'galaxy-tab', name: 'Galaxy Tab S9', w: 800, h: 1280, type: 'tablet', fav: false },
  { id: 'laptop', name: 'Laptop', w: 1366, h: 768, type: 'desktop', fav: true },
  { id: 'laptop-hidpi', name: 'MacBook Air', w: 1440, h: 900, type: 'desktop', fav: false },
  { id: 'desktop-hd', name: 'Desktop Full HD', w: 1920, h: 1080, type: 'desktop', fav: false },
];

const settings = {
  devices: DEFAULT_DEVICES.map((d) => ({ ...d })),
  tab: 'default',
  zoom: '0.5',
  grid: 'off',
  view: { ruler: false, wrap: true },
  sync: { scroll: true, nav: true, click: false },
  opts: { design: false, inspect: false, outline: false, noCss: false, noScrollbar: false, overflow: false },
  rotated: {},
  lastUrl: '',
  sites: [], // { id, name, url, icon }
  compare: { on: false, base: '', mode: 'opacity', amount: 50 },
  fluidAdded: false,
};

let currentUrl = '';
let pageTitle = '';
let lastScroll = { x: 0, y: 0 };
// id -> { dev, card, screen, iframe, iframeB, url, loading, bTarget, ovf, media, panel }
const frames = new Map();

// ---------- utilities ----------

function save() {
  chrome.storage.local.set({ settings });
}

let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function normalizeUrl(v) {
  v = (v || '').trim();
  if (!v) return '';
  if (/^(https?|file):/i.test(v)) return v;
  if (/^(localhost|127\.|\d+\.\d+\.\d+\.\d+|\[)/.test(v)) return 'http://' + v;
  return 'https://' + v;
}

const isFluid = (f) => f.dev.type === 'fluid';
const fluidFrame = () => [...frames.values()].find(isFluid);

function dims(f) {
  const r = !isFluid(f) && settings.rotated[f.dev.id];
  return r ? { w: f.dev.h, h: f.dev.w } : { w: f.dev.w, h: f.dev.h };
}

function zoomValue() {
  if (settings.zoom !== 'fit') return parseFloat(settings.zoom);
  const avail = innerHeight - $('.bar').offsetHeight - (settings.view.ruler ? 110 : 90);
  let z = 1;
  for (const f of frames.values()) z = Math.min(z, avail / dims(f).h);
  return Math.max(0.1, Math.min(1, z));
}

function post(win, msg) {
  try {
    win.postMessage({ rv: 1, ...msg }, '*');
  } catch {}
}

const send = (f, msg) => post(f.iframe.contentWindow, msg);
const sendB = (f, msg) => compareActive() && post(f.iframeB.contentWindow, msg);

// Every A frame except the source, plus every B frame.
function broadcast(msg, exceptFrame) {
  for (const f of frames.values()) {
    if (f !== exceptFrame) send(f, msg);
    sendB(f, msg);
  }
}

// ---------- headers: allow sites that block iframes ----------

async function allowFraming() {
  const tab = await chrome.tabs.getCurrent();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tab.id],
    addRules: [{
      id: tab.id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
          { header: 'content-security-policy-report-only', operation: 'remove' },
          { header: 'cross-origin-embedder-policy', operation: 'remove' },
          { header: 'cross-origin-resource-policy', operation: 'remove' },
        ],
      },
      condition: { tabIds: [tab.id], resourceTypes: ['sub_frame'] },
    }],
  });
}

// ---------- render ----------

function visibleDevices() {
  const t = settings.tab;
  if (t === 'all') return settings.devices;
  if (t === 'default') return settings.devices.filter((d) => d.fav);
  return settings.devices.filter((d) => d.type === t);
}

const typeIcon = (type) => (['tablet', 'desktop', 'fluid'].includes(type) ? type : 'mobile');

function render() {
  const stage = $('#stage');
  stage.innerHTML = '';
  frames.clear();

  const list = visibleDevices();
  if (!list.length) {
    stage.innerHTML = `<p class="empty">${icon('layers', 'dim')}No devices in this tab. Use "Add device", or star a device in another tab.</p>`;
    renderBp();
    return;
  }

  for (const dev of list) {
    const fluid = dev.type === 'fluid';
    const card = document.createElement('section');
    card.className = 'card' + (fluid ? ' fluid' : '');
    card.innerHTML = `
      <div class="card-head">
        <span class="meta">${icon(typeIcon(dev.type), 'type')}<b></b><span class="dims"></span>
          <button class="ovf" data-c="ovf" hidden>${icon('overflow')}<span></span></button></span>
        <span class="tools">
          <button data-c="fav" class="fav" title="Show in Pinned" aria-label="Pin">${icon('star')}</button>
          ${fluid ? '' : `<button data-c="rotate" title="Rotate" aria-label="Rotate">${icon('rotate')}</button>`}
          <button data-c="reload" title="Reload" aria-label="Reload">${icon('reload')}</button>
          <button data-c="shot" title="Screenshot" aria-label="Screenshot">${icon('camera')}</button>
          <button data-c="open" title="Open in a new tab" aria-label="Open in a new tab">${icon('external')}</button>
          <button data-c="remove" class="rm" title="Remove device" aria-label="Remove device">${icon('close')}</button>
        </span>
        <div class="ovf-panel" hidden></div>
      </div>
      <div class="screen">
        <iframe class="a" allow="clipboard-read; clipboard-write; fullscreen; geolocation; camera; microphone"></iframe>
        <iframe class="b" tabindex="-1" aria-hidden="true" hidden></iframe>
        <div class="swipe-line"><span class="ab a">A</span><span class="ab b">B</span></div>
        <div class="overlay"></div>
        <div class="ruler h"></div>
        <div class="ruler v"></div>
        ${fluid ? '<div class="grip" title="Drag to resize"></div>' : ''}
      </div>`;
    $('b', card).textContent = dev.name;
    $('.fav', card).classList.toggle('on', !!dev.fav);

    const f = {
      dev, card, screen: $('.screen', card), iframe: $('iframe.a', card), iframeB: $('iframe.b', card),
      url: '', loading: false, bTarget: '', ovf: { extra: 0, items: [] }, media: null,
    };
    frames.set(dev.id, f);
    f.iframe.addEventListener('load', () => send(f, { cmd: 'hello', id: dev.id, opts: settings.opts }));
    f.iframeB.addEventListener('load', () => {
      if (!compareActive()) return;
      post(f.iframeB.contentWindow, { cmd: 'hello', id: dev.id + ':b', opts: settings.opts });
      post(f.iframeB.contentWindow, { cmd: 'scroll', ...lastScroll });
    });
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (b) cardAction(f, b.dataset.c, b);
    });
    if (fluid) bindGrip(f);
    stage.appendChild(card);
  }

  layout();
  if (currentUrl) for (const f of frames.values()) load(f, currentUrl);
  syncCompare();
  renderBp();
}

function layout(zOverride) {
  const z = zOverride || zoomValue();
  document.documentElement.style.setProperty('--z', z);
  for (const f of frames.values()) {
    const { w, h } = dims(f);
    f.card.style.width = w * z + 'px';
    f.screen.style.width = w * z + 'px';
    f.screen.style.height = h * z + 'px';
    for (const fr of [f.iframe, f.iframeB]) {
      fr.style.width = w + 'px';
      fr.style.height = h + 'px';
    }
    $('.dims', f.card).textContent = `${w}×${h} · ${Math.round(z * 100)}%`;
    buildRuler($('.ruler.h', f.card), w, z, 'left');
    buildRuler($('.ruler.v', f.card), h, z, 'top');
  }
}

function buildRuler(el, size, z, prop) {
  const step = z < 0.3 ? 200 : 100;
  let html = '';
  for (let v = 0; v <= size; v += step) html += `<span style="${prop}:${v * z}px">${v}</span>`;
  el.innerHTML = html;
}

// "loading": the first "ready" after we load a URL (redirects included)
// does not count as user navigation.
function load(f, url) {
  f.url = url;
  f.loading = true;
  f.iframe.src = url;
  f.ovf = { extra: 0, items: [] };
  updateOverflow(f);
  loadB(f);
}

function loadAll(url) {
  url = normalizeUrl(url);
  if (!url) return;
  currentUrl = url;
  settings.lastUrl = url;
  pageTitle = '';
  save();
  renderSites();
  $('#url').value = url;
  history.replaceState(null, '', '?url=' + encodeURIComponent(url));
  for (const f of frames.values()) load(f, url);
}

// ---------- fluid device + breakpoint bar ----------

const bp = { list: [], pending: 0, token: 0, lo: FLUID_MIN, hi: 1920, drag: false };
const remoteMedia = new Map(); // stylesheet URL -> Promise<string[]>

// Stylesheets from other origins can't be read from inside the page; the
// extension page can fetch them thanks to its host permissions.
function fetchMedia(href) {
  if (!remoteMedia.has(href)) {
    remoteMedia.set(href, fetch(href)
      .then((r) => (r.ok ? r.text() : ''))
      .then((css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@media([^{;]+)\{/g)].map((m) => m[1].trim()))
      .catch(() => []));
  }
  return remoteMedia.get(href);
}

const toPx = (v, unit) => parseFloat(v) * (/em$/i.test(unit) ? 16 : 1);
const FLIP = { '>=': '<=', '<=': '>=', '>': '<', '<': '>' };

// The width where the layout changes: min-width: 768px -> 768, max-width: 767px -> 768.
function boundary(op, v) {
  switch (op) {
    case '>=': return { w: Math.ceil(v), kind: 'min' };
    case '>': return { w: Math.floor(v) + 1, kind: 'min' };
    case '<=': return { w: Math.floor(v) + 1, kind: 'max' };
    default: return { w: Math.ceil(v), kind: 'max' };
  }
}

function parseBreakpoints(texts) {
  const map = new Map();
  const add = ({ w, kind }) => {
    if (!(w > 0 && w < 10000)) return;
    const e = map.get(w) || { w, min: 0, max: 0 };
    e[kind]++;
    map.set(w, e);
  };
  for (const t of texts) {
    for (const m of t.matchAll(/\b(min|max)-width\s*:\s*([\d.]+)\s*(px|r?em)\b/gi)) {
      add(boundary(m[1].toLowerCase() === 'min' ? '>=' : '<=', toPx(m[2], m[3])));
    }
    for (const m of t.matchAll(/(?<![\w-])width\s*(>=|<=|>|<)\s*([\d.]+)\s*(px|r?em)\b/gi)) {
      add(boundary(m[1], toPx(m[2], m[3])));
    }
    for (const m of t.matchAll(/([\d.]+)\s*(px|r?em)\s*(>=|<=|>|<)\s*width(?![\w-])/gi)) {
      add(boundary(FLIP[m[3]], toPx(m[1], m[2])));
    }
  }
  return [...map.values()].sort((a, b) => a.w - b.w);
}

async function updateBreakpoints(f) {
  const token = ++bp.token;
  const { texts, remote } = f.media;
  bp.list = parseBreakpoints(texts);
  bp.pending = remote.length;
  renderBp();
  if (!remote.length) return;
  const more = await Promise.all(remote.map(fetchMedia));
  if (token !== bp.token) return;
  bp.list = parseBreakpoints([...texts, ...more.flat()]);
  bp.pending = 0;
  renderBp();
}

const pct = (w) => clamp(((w - bp.lo) / (bp.hi - bp.lo)) * 100, 0, 100);

function renderBp() {
  const bar = $('#bpbar');
  const ff = fluidFrame();
  bar.hidden = !ff;
  if (!ff) return;
  const list = bp.list;
  const others = [...frames.values()].filter((f) => !isFluid(f)).map((f) => ({ name: f.dev.name, w: dims(f).w }));
  bp.hi = Math.max(1920, ...list.map((b) => b.w + 120), ...others.map((o) => o.w + 80), ff.dev.w + 80);

  const kindTitle = (b) => [b.min && `min-width ${b.w}px (${b.min})`, b.max && `max-width ${b.w - 1}px (${b.max})`]
    .filter(Boolean).join(' · ');
  const meta = list.length
    ? `${list.length} breakpoint${list.length > 1 ? 's' : ''} in the page CSS`
    : (ff.media ? 'No width media queries found' : 'Waiting for the page');
  bar.innerHTML = `
    <div class="bp-head">
      ${icon('fluid')}<b>Breakpoints</b>
      <span class="bp-meta">${meta}${bp.pending ? ` · reading ${bp.pending} external stylesheet${bp.pending > 1 ? 's' : ''}` : ''}</span>
      <span class="bp-hint">Drag the track or the edge of the Fluid frame · click a mark to jump · Alt+click for 1px below</span>
      <div class="seg bp-nav">
        <button class="ib" data-bp="prev" title="Previous breakpoint" aria-label="Previous breakpoint">${icon('back')}</button>
        <label class="bp-w" title="Fluid width"><input id="bpWidth" type="number" min="${FLUID_MIN}" max="${FLUID_MAX}"><span>px</span></label>
        <button class="ib" data-bp="next" title="Next breakpoint" aria-label="Next breakpoint">${icon('forward')}</button>
      </div>
    </div>
    <div class="bp-track" id="bpTrack">
      <div class="bp-range"></div>
      <div class="bp-line"></div>
      ${list.map((b) => `<button class="bp-tick ${b.min && b.max ? 'both' : b.min ? 'min' : 'max'}" data-w="${b.w}" style="left:${pct(b.w)}%" title="${kindTitle(b)}"><span>${b.w}</span></button>`).join('')}
      ${others.map((o) => `<button class="bp-dev" data-w="${o.w}" style="left:${pct(o.w)}%" title="${esc(o.name)} · ${o.w}px"></button>`).join('')}
      <div class="bp-thumb" tabindex="0" role="slider" aria-label="Fluid width" aria-valuemin="${FLUID_MIN}" aria-valuemax="${FLUID_MAX}"></div>
      <div class="bp-scale"><span>${bp.lo}</span><span>${bp.hi}</span></div>
    </div>`;

  // Two label rows so close breakpoints don't overlap; hide a label if both are taken.
  const track = $('#bpTrack');
  const tw = track.clientWidth;
  const last = [-1e9, -1e9];
  for (const t of $$('.bp-tick', track)) {
    const x = (pct(+t.dataset.w) / 100) * tw;
    const row = x - last[0] >= 40 ? 0 : x - last[1] >= 40 ? 1 : -1;
    t.classList.toggle('row2', row === 1);
    t.classList.toggle('nolabel', row === -1);
    if (row >= 0) last[row] = x;
  }
  updateBp();
}

function updateBp() {
  const ff = fluidFrame();
  if (!ff || $('#bpbar').hidden) return;
  const w = ff.dev.w;
  const prev = [...bp.list].reverse().find((b) => b.w <= w);
  const next = bp.list.find((b) => b.w > w);
  const range = $('.bp-range');
  range.style.left = (prev ? pct(prev.w) : 0) + '%';
  range.style.right = 100 - (next ? pct(next.w) : 100) + '%';
  const thumb = $('.bp-thumb');
  thumb.style.left = pct(w) + '%';
  thumb.setAttribute('aria-valuenow', w);
  thumb.dataset.w = w;
  const input = $('#bpWidth');
  if (document.activeElement !== input) input.value = w;
  for (const t of $$('.bp-tick')) t.classList.toggle('hit', +t.dataset.w === w);
}

// Ask a frame to re-check overflow after we change its size, without relying
// on the page's own resize event.
function rescanSoon(f) {
  clearTimeout(f.rescanTimer);
  f.rescanTimer = setTimeout(() => send(f, { cmd: 'rescan' }), 300);
}

function setFluidWidth(w, persist = true) {
  const ff = fluidFrame();
  if (!ff) return;
  w = clamp(Math.round(w), FLUID_MIN, FLUID_MAX);
  if (w === ff.dev.w) return;
  ff.dev.w = w;
  layout();
  rescanSoon(ff);
  if (w > bp.hi - 40 || w < bp.lo) renderBp();
  else updateBp();
  if (persist) saveSoon();
}

function widthFromTrack(clientX) {
  const r = $('#bpTrack').getBoundingClientRect();
  let w = bp.lo + ((clientX - r.left) / r.width) * (bp.hi - bp.lo);
  // Snap to a breakpoint within 6 screen pixels.
  const px = (bp.hi - bp.lo) / r.width;
  for (const b of bp.list) if (Math.abs(b.w - w) <= 6 * px) w = b.w;
  return w;
}

function bindBreakpointBar() {
  const bar = $('#bpbar');
  bar.addEventListener('click', (e) => {
    const t = e.target.closest('.bp-tick, .bp-dev');
    if (t) {
      setFluidWidth(+t.dataset.w - (e.altKey ? 1 : 0));
      return;
    }
    const nav = e.target.closest('[data-bp]');
    if (!nav) return;
    const ff = fluidFrame();
    const w = ff.dev.w;
    const target = nav.dataset.bp === 'next'
      ? bp.list.find((b) => b.w > w)
      : [...bp.list].reverse().find((b) => b.w < w);
    if (target) setFluidWidth(target.w);
  });
  bar.addEventListener('change', (e) => {
    if (e.target.id === 'bpWidth') setFluidWidth(+e.target.value);
  });
  bar.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('bp-thumb')) return;
    const step = e.shiftKey ? 10 : 1;
    const w = fluidFrame().dev.w;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setFluidWidth(w + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setFluidWidth(w - step);
    else return;
    e.preventDefault();
  });
  bar.addEventListener('pointerdown', (e) => {
    const track = e.target.closest('#bpTrack');
    if (!track || e.target.closest('.bp-tick, .bp-dev') || e.button !== 0) return;
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    setFluidWidth(widthFromTrack(e.clientX), false);
    const move = (ev) => setFluidWidth(widthFromTrack(ev.clientX), false);
    const up = () => {
      track.removeEventListener('pointermove', move);
      document.body.classList.remove('dragging');
      $('.bp-thumb').focus();
      save();
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up, { once: true });
    track.addEventListener('pointercancel', up, { once: true });
  });
}

// The handle on the right edge of the Fluid frame.
function bindGrip(f) {
  const grip = $('.grip', f.card);
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    const startX = e.clientX;
    const startW = f.dev.w;
    const z = zoomValue();
    const move = (ev) => setFluidWidth(startW + (ev.clientX - startX) / z, false);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      document.body.classList.remove('dragging');
      save();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    grip.addEventListener('pointercancel', up, { once: true });
  });
}

// ---------- horizontal overflow ----------

function updateOverflow(f) {
  const { extra, items } = f.ovf;
  const btn = $('.ovf', f.card);
  const n = extra > 0 ? Math.max(1, items.length) : 0;
  btn.hidden = !n;
  if (n) {
    $('span', btn).textContent = n;
    btn.title = `The page is ${extra}px wider than the screen` +
      (items.length ? ` · ${items.length} element${items.length > 1 ? 's' : ''} to blame` : '');
  }
  const panel = $('.ovf-panel', f.card);
  if (!n) panel.hidden = true;
  if (!panel.hidden) renderOverflowPanel(f);
}

function renderOverflowPanel(f) {
  const { extra, items } = f.ovf;
  const panel = $('.ovf-panel', f.card);
  panel.innerHTML = `
    <div class="ovf-top">
      <b>Scrolls sideways by ${extra}px</b>
      <button data-c="ovf-hl" class="${settings.opts.overflow ? 'on' : ''}" aria-pressed="${!!settings.opts.overflow}">Highlight</button>
      <button data-c="ovf" class="x" title="Close" aria-label="Close">${icon('close')}</button>
    </div>
    ${items.length
      ? `<ol>${items.map((it, i) => `<li><button data-c="ovf-item" data-i="${i}" title="Scroll to it on this device">
          <code>${esc(it.label)}</code><span>${it.width}px wide · +${it.over}px</span></button></li>`).join('')}</ol>`
      : '<p>No single element found to blame. Check margins, transforms or 100vw widths.</p>'}`;
}

function setOpt(name, value) {
  settings.opts[name] = value;
  save();
  syncToolbar();
  broadcast({ cmd: 'opts', opts: settings.opts });
  for (const f of frames.values()) if (!$('.ovf-panel', f.card).hidden) renderOverflowPanel(f);
}

// ---------- compare A with B ----------

const compareActive = () => settings.compare.on && !!settings.compare.base;

// B keeps A's path, query and hash, on B's own origin.
function bUrlFor(aUrl) {
  try {
    const a = new URL(aUrl);
    const b = new URL(normalizeUrl(settings.compare.base));
    return b.origin + a.pathname + a.search + a.hash;
  } catch {
    return '';
  }
}

function loadB(f, force) {
  if (!compareActive()) return;
  const target = bUrlFor(f.url || currentUrl);
  if (!target || (!force && target === f.bTarget)) return;
  f.bTarget = target;
  f.iframeB.src = target;
}

function syncCompare() {
  const c = settings.compare;
  const active = compareActive();
  document.body.classList.toggle('cmp-on', active);
  for (const m of ['opacity', 'difference', 'swipe']) document.body.classList.toggle('cmp-' + m, active && c.mode === m);
  document.documentElement.style.setProperty('--cmp-o', c.amount / 100);
  document.documentElement.style.setProperty('--cmp-x', c.amount + '%');
  setOn($('#compareBtn'), c.on);
  $('#cmpRow').hidden = !c.on;
  $$('[data-cmp-mode]').forEach((b) => setOn(b, b.dataset.cmpMode === c.mode));
  const amount = $('#cmpAmount');
  amount.value = c.amount;
  amount.closest('label').hidden = c.mode === 'difference';
  $('#cmpAmountLabel').textContent = c.mode === 'swipe' ? 'Split' : 'Opacity';
  $('#cmpAmountOut').textContent = c.amount + '%';
  if (document.activeElement !== $('#cmpBase')) $('#cmpBase').value = c.base;
  renderComparePick();

  for (const f of frames.values()) {
    f.iframeB.hidden = !active;
    if (active) loadB(f);
    else if (f.bTarget) {
      f.bTarget = '';
      f.iframeB.src = 'about:blank';
    }
  }
}

function renderComparePick() {
  const pick = $('#cmpPick');
  const base = settings.compare.base;
  pick.innerHTML = '<option value="">Favorites</option>' + settings.sites
    .map((s) => `<option value="${esc(s.url)}"${base && originOf(s.url) === originOf(normalizeUrl(base)) ? ' selected' : ''}>${esc(s.name)}</option>`)
    .join('');
}

function setCompareBase(v) {
  settings.compare.base = normalizeUrl(v);
  save();
  for (const f of frames.values()) f.bTarget = '';
  syncCompare();
}

function bindCompare() {
  $('#compareBtn').addEventListener('click', () => {
    settings.compare.on = !settings.compare.on;
    save();
    syncCompare();
    if (settings.compare.on && !settings.compare.base) {
      $('#cmpBase').focus();
      toast('Type the address of site B, e.g. your staging server');
    }
  });
  $('#cmpRow').addEventListener('submit', (e) => {
    e.preventDefault();
    setCompareBase($('#cmpBase').value);
  });
  $('#cmpPick').addEventListener('change', (e) => {
    if (e.target.value) setCompareBase(e.target.value);
  });
  $$('[data-cmp-mode]').forEach((b) => b.addEventListener('click', () => {
    settings.compare.mode = b.dataset.cmpMode;
    if (settings.compare.mode === 'swipe') settings.compare.amount = 50;
    save();
    syncCompare();
  }));
  $('#cmpAmount').addEventListener('input', (e) => {
    settings.compare.amount = +e.target.value;
    saveSoon();
    syncCompare();
  });
  $('#cmpSwap').addEventListener('click', () => {
    if (!compareActive() || !currentUrl) return;
    const newA = bUrlFor(currentUrl);
    settings.compare.base = originOf(currentUrl);
    save();
    for (const f of frames.values()) f.bTarget = '';
    syncCompare();
    loadAll(newA);
  });
}

// ---------- favorite sites ----------

const urlKey = (u) => (u || '').replace(/#.*$/, '').replace(/\/+$/, '');
const findSite = (u) => settings.sites.find((x) => urlKey(x.url) === urlKey(u));

function hostOf(u) {
  try {
    return new URL(u).hostname || u;
  } catch {
    return u;
  }
}

function originOf(u) {
  try {
    return new URL(u).origin;
  } catch {
    return '';
  }
}

// The browser's own favicon cache ("favicon" permission).
const faviconApi = (u) => chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(u) + '&size=32';

// Minibox: try the page's favicon, then the browser's, and finally an initial.
function faviconBox(site) {
  const box = document.createElement('span');
  box.className = 'fbox';
  const sources = [site.icon, faviconApi(site.url)].filter(Boolean);
  const next = () => {
    const src = sources.shift();
    if (!src) {
      box.className = 'fbox mono';
      box.textContent = (site.name || hostOf(site.url)).trim().charAt(0) || '?';
      return;
    }
    const img = new Image(16, 16);
    img.alt = '';
    img.onerror = () => {
      img.remove();
      next();
    };
    img.src = src;
    box.replaceChildren(img);
  };
  next();
  return box;
}

function renderSites() {
  const bar = $('#sites');
  bar.replaceChildren();
  for (const site of settings.sites) {
    const el = document.createElement('div');
    el.className = 'site';
    el.draggable = true;
    el.dataset.id = site.id;
    el.classList.toggle('on', !!currentUrl && urlKey(site.url) === urlKey(currentUrl));
    el.innerHTML = `<button class="site-open"><span class="site-name"></span></button>
      <button class="site-x" title="Remove from favorites" aria-label="Remove from favorites">${icon('close')}</button>`;
    const open = $('.site-open', el);
    open.title = `${site.name}\n${site.url}`;
    open.prepend(faviconBox(site));
    $('.site-name', el).textContent = site.name;
    open.addEventListener('click', () => loadAll(site.url));
    $('.site-x', el).addEventListener('click', () => removeSite(site));
    bar.appendChild(el);
  }
  const add = document.createElement('button');
  add.className = 'site-add';
  add.title = 'Add favorite site';
  add.innerHTML = `${icon('plus')}<span>${settings.sites.length ? 'Add' : 'Add favorite site'}</span>`;
  add.addEventListener('click', () => openSiteDialog());
  bar.appendChild(add);

  const star = $('#favSite');
  const saved = !!currentUrl && !!findSite(currentUrl);
  star.classList.toggle('on', saved);
  star.disabled = !currentUrl;
  star.title = saved ? 'Remove from favorite sites' : 'Save to favorite sites';
  renderComparePick();
}

function addSite(name, url) {
  url = normalizeUrl(url);
  if (!url) return;
  name = (name || '').trim() || hostOf(url);
  const existing = findSite(url);
  if (existing) existing.name = name;
  else settings.sites.push({ id: 's' + Date.now(), name, url, icon: '' });
  save();
  renderSites();
  toast(`"${name}" added to favorites`);
}

function removeSite(site) {
  settings.sites = settings.sites.filter((x) => x !== site);
  save();
  renderSites();
  toast(`"${site.name}" removed from favorites`);
}

function openSiteDialog() {
  const form = $('#siteForm');
  form.elements.url.value = currentUrl;
  form.elements.name.value = currentUrl ? pageTitle || hostOf(currentUrl) : '';
  $('#siteDialog').showModal();
  (currentUrl ? form.elements.name : form.elements.url).select();
}

// Remember the favicon the page declares, for sites the browser hasn't cached.
function rememberIcon(url, iconUrl) {
  if (!iconUrl) return;
  const origin = originOf(url);
  let changed = false;
  for (const site of settings.sites) {
    if (originOf(site.url) === origin && site.icon !== iconUrl) {
      site.icon = iconUrl;
      changed = true;
    }
  }
  if (changed) {
    save();
    renderSites();
  }
}

function bindSites() {
  $('#favSite').addEventListener('click', () => {
    if (!currentUrl) return;
    const site = findSite(currentUrl);
    if (site) removeSite(site);
    else addSite(pageTitle, currentUrl);
  });

  const dlg = $('#siteDialog');
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const fd = new FormData($('#siteForm'));
    addSite(fd.get('name'), fd.get('url'));
  });

  // Drag to reorder
  const bar = $('#sites');
  bar.addEventListener('dragstart', (e) => {
    const el = e.target.closest && e.target.closest('.site');
    if (!el) return;
    el.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', el.dataset.id);
  });
  bar.addEventListener('dragover', (e) => {
    const dragging = $('.site.drag', bar);
    if (!dragging) return;
    e.preventDefault();
    const over = e.target.closest && e.target.closest('.site');
    if (!over || over === dragging) return;
    const r = over.getBoundingClientRect();
    if (e.clientX > r.left + r.width / 2) over.after(dragging);
    else over.before(dragging);
  });
  bar.addEventListener('dragend', () => {
    const dragging = $('.site.drag', bar);
    if (!dragging) return;
    const byId = new Map(settings.sites.map((x) => [x.id, x]));
    settings.sites = $$('.site', bar).map((el) => byId.get(el.dataset.id)).filter(Boolean);
    save();
    renderSites();
  });
}

// ---------- actions ----------

async function cardAction(f, c, btn) {
  switch (c) {
    case 'fav':
      f.dev.fav = !f.dev.fav;
      save();
      if (settings.tab === 'default') render();
      else $('.fav', f.card).classList.toggle('on', f.dev.fav);
      break;
    case 'rotate':
      settings.rotated[f.dev.id] = !settings.rotated[f.dev.id];
      save();
      layout();
      renderBp();
      rescanSoon(f);
      break;
    case 'reload':
      load(f, f.url || currentUrl);
      if (compareActive()) loadB(f, true);
      break;
    case 'shot':
      await screenshot([f]);
      break;
    case 'open':
      chrome.tabs.create({ url: f.url || currentUrl });
      break;
    case 'remove':
      if (!confirm(`Remove "${f.dev.name}" from the list?`)) return;
      settings.devices = settings.devices.filter((d) => d !== f.dev);
      save();
      render();
      break;
    case 'ovf': {
      const panel = $('.ovf-panel', f.card);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderOverflowPanel(f);
      break;
    }
    case 'ovf-hl':
      setOpt('overflow', !settings.opts.overflow);
      break;
    case 'ovf-item': {
      const it = f.ovf.items[+btn.dataset.i];
      if (!it) break;
      if (!settings.opts.overflow) setOpt('overflow', true);
      send(f, { cmd: 'reveal', path: it.path });
      break;
    }
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function screenshot(list) {
  document.body.classList.add('capturing');
  try {
    for (const f of list) {
      // Zoom in as far as the window allows so the capture is sharp.
      const { w: dw0, h: dh0 } = dims(f);
      const barH = $('.bar').offsetHeight;
      layout(Math.min(1, (innerWidth - 60) / dw0, (innerHeight - barH - 60) / dh0));
      f.screen.scrollIntoView({ block: 'center', inline: 'center' });
      await wait(300);
      const dataUrl = await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = dataUrl;
      });
      const scale = img.width / innerWidth;
      const r = f.screen.getBoundingClientRect();
      const x = Math.max(0, r.left), y = Math.max(0, r.top);
      const w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, x * scale, y * scale, w * scale, h * scale, 0, 0, canvas.width, canvas.height);
      download(canvas.toDataURL('image/png'), `${slug(f.dev.name)}-${dw0}x${dh0}.png`);
      if (list.length > 1) await wait(550); // Chrome limit: 2 captures per second
    }
  } catch (err) {
    toast('Screenshot failed: ' + err.message);
  } finally {
    document.body.classList.remove('capturing');
    layout();
  }
  if (list.length > 1) toast(`${list.length} screenshots saved`);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function download(href, name) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

let pendingHtml = false;
function exportHtml() {
  const f = frames.values().next().value;
  if (!f) return;
  pendingHtml = true;
  send(f, { cmd: 'html' });
  setTimeout(() => {
    if (pendingHtml) {
      pendingHtml = false;
      toast("Couldn't read this page's HTML");
    }
  }, 1500);
}

function toolbarAction(act) {
  switch (act) {
    case 'reload':
      for (const f of frames.values()) {
        load(f, f.url || currentUrl);
        if (compareActive()) loadB(f, true);
      }
      break;
    case 'back':
    case 'forward': {
      // With navigation sync on, moving one is enough; the others follow.
      if (!settings.sync.nav) for (const f of frames.values()) send(f, { cmd: act });
      else {
        const first = frames.values().next().value;
        if (first) send(first, { cmd: act });
      }
      break;
    }
    case 'rotateAll': {
      const list = [...frames.values()].filter((f) => !isFluid(f));
      const anyUnrotated = list.some((f) => !settings.rotated[f.dev.id]);
      for (const f of list) settings.rotated[f.dev.id] = anyUnrotated;
      save();
      layout();
      renderBp();
      list.forEach(rescanSoon);
      break;
    }
    case 'shotAll':
      screenshot([...frames.values()]);
      break;
    case 'exportHtml':
      exportHtml();
      break;
  }
}

// ---------- messages from the iframes ----------

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || !d.rv || !d.type) return;
  let f = null;
  for (const x of frames.values()) {
    if (x.iframe.contentWindow === e.source) f = x;
    // B frames only follow A; nothing they report is acted on.
    if (x.iframeB.contentWindow === e.source) return;
  }
  if (!f) return;

  switch (d.type) {
    case 'ready':
      f.url = d.url;
      if (urlKey(d.url) === urlKey(currentUrl) && d.title) pageTitle = d.title;
      rememberIcon(d.url, d.icon);
      $('.card-head b', f.card).title = d.title || d.url;
      loadB(f);
      if (f.loading) {
        f.loading = false;
        break;
      }
      if (!settings.sync.nav || d.url === currentUrl) break;
      if (!/^(https?|file):/.test(d.url)) break;
      currentUrl = d.url;
      pageTitle = d.title || '';
      $('#url').value = d.url;
      renderSites();
      history.replaceState(null, '', '?url=' + encodeURIComponent(d.url));
      for (const o of frames.values()) if (o !== f && o.url !== d.url) load(o, d.url);
      break;
    case 'scroll':
      lastScroll = { x: d.x, y: d.y };
      if (settings.sync.scroll) broadcast({ cmd: 'scroll', x: d.x, y: d.y }, f);
      else sendB(f, { cmd: 'scroll', x: d.x, y: d.y });
      break;
    case 'click':
      if (settings.sync.click) broadcast({ cmd: 'click', path: d.path }, f);
      else sendB(f, { cmd: 'click', path: d.path });
      break;
    case 'input':
      if (settings.sync.click) broadcast({ cmd: 'input', path: d.path, value: d.value }, f);
      else sendB(f, { cmd: 'input', path: d.path, value: d.value });
      break;
    case 'overflow':
      f.ovf = { extra: d.extra, items: d.items || [] };
      updateOverflow(f);
      break;
    case 'media':
      f.media = { texts: d.texts || [], remote: d.remote || [] };
      if (isFluid(f)) updateBreakpoints(f);
      break;
    case 'html':
      if (!pendingHtml) break;
      pendingHtml = false;
      download(URL.createObjectURL(new Blob([d.html], { type: 'text/html' })), 'edited-page.html');
      break;
  }
});

// ---------- UI ----------

function setOn(b, on) {
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', on);
}

function syncToolbar() {
  $$('[data-sync]').forEach((b) => setOn(b, !!settings.sync[b.dataset.sync]));
  $$('[data-opt]').forEach((b) => setOn(b, !!settings.opts[b.dataset.opt]));
  $$('[data-view]').forEach((b) => setOn(b, !!settings.view[b.dataset.view]));
  $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === settings.tab));
  $('#grid').value = settings.grid;
  $('#zoom').value = settings.zoom;
  document.body.dataset.grid = settings.grid;
  document.body.classList.toggle('rulers-on', settings.view.ruler);
  document.body.classList.toggle('nowrap', !settings.view.wrap);
}

function bindUi() {
  $('#urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    loadAll($('#url').value);
  });
  $$('[data-act]').forEach((b) => b.addEventListener('click', () => toolbarAction(b.dataset.act)));

  $$('[data-sync]').forEach((b) => b.addEventListener('click', () => {
    settings.sync[b.dataset.sync] = !settings.sync[b.dataset.sync];
    save();
    syncToolbar();
  }));
  $$('[data-opt]').forEach((b) => b.addEventListener('click', () => setOpt(b.dataset.opt, !settings.opts[b.dataset.opt])));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => {
    settings.view[b.dataset.view] = !settings.view[b.dataset.view];
    save();
    syncToolbar();
    layout();
  }));
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    settings.tab = b.dataset.tab;
    save();
    syncToolbar();
    render();
  }));
  $('#grid').addEventListener('change', (e) => {
    settings.grid = e.target.value;
    save();
    syncToolbar();
  });
  $('#zoom').addEventListener('change', (e) => {
    settings.zoom = e.target.value;
    save();
    layout();
  });
  addEventListener('resize', () => {
    if (settings.zoom === 'fit') layout();
    renderBp();
  });

  // Ctrl + mouse wheel changes the device zoom
  addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const steps = [...$('#zoom').options].map((o) => o.value).filter((v) => v !== 'fit').map(Number);
    const z = zoomValue();
    let i = steps.findIndex((s) => s >= z - 0.001);
    if (i < 0) i = steps.length - 1;
    i = Math.max(0, Math.min(steps.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
    settings.zoom = String(steps[i]);
    $('#zoom').value = settings.zoom;
    save();
    layout();
  }, { passive: false });

  const dlg = $('#deviceDialog');
  $('#addDevice').addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const fd = new FormData($('#deviceForm'));
    const dev = {
      id: 'custom-' + Date.now(),
      name: fd.get('name').trim() || 'Custom',
      w: Math.max(100, parseInt(fd.get('w'), 10)),
      h: Math.max(100, parseInt(fd.get('h'), 10)),
      type: fd.get('type'),
      fav: fd.get('fav') === 'on',
    };
    settings.devices.push(dev);
    save();
    render();
    toast(`"${dev.name}" added`);
  });

  $('#resetDevices').addEventListener('click', () => {
    if (!confirm('Restore the default device list? Custom devices will be removed.')) return;
    settings.devices = DEFAULT_DEVICES.map((d) => ({ ...d }));
    settings.rotated = {};
    save();
    render();
  });
}

(async function init() {
  const stored = (await chrome.storage.local.get('settings')).settings;
  if (stored) {
    for (const k of Object.keys(settings)) {
      if (stored[k] === undefined) continue;
      settings[k] = typeof settings[k] === 'object' && !Array.isArray(settings[k])
        ? { ...settings[k], ...stored[k] }
        : stored[k];
    }
  }
  // Older installs: add the Fluid device once, at the front.
  if (!settings.fluidAdded) {
    if (!settings.devices.some((d) => d.type === 'fluid')) settings.devices.unshift({ ...FLUID });
    settings.fluidAdded = true;
    save();
  }
  try {
    await allowFraming();
  } catch (err) {
    toast('Warning: could not unblock iframes (' + err.message + ')');
  }
  bindUi();
  bindSites();
  bindBreakpointBar();
  bindCompare();
  syncToolbar();
  const fromQuery = new URLSearchParams(location.search).get('url');
  currentUrl = normalizeUrl(fromQuery || settings.lastUrl || '');
  $('#url').value = currentUrl;
  renderSites();
  render();
  if (!currentUrl) $('#url').focus();
})();
