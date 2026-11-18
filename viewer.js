const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const DEFAULT_DEVICES = [
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
  opts: { design: false, inspect: false, outline: false, noCss: false, noScrollbar: false },
  rotated: {},
  lastUrl: '',
  sites: [], // { id, name, url, icon }
};

let currentUrl = '';
let pageTitle = '';
const frames = new Map(); // id -> { dev, card, screen, iframe, url, loading }

// ---------- utilities ----------

function save() {
  chrome.storage.local.set({ settings });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function normalizeUrl(v) {
  v = v.trim();
  if (!v) return '';
  if (/^(https?|file):/i.test(v)) return v;
  if (/^(localhost|127\.|\d+\.\d+\.\d+\.\d+|\[)/.test(v)) return 'http://' + v;
  return 'https://' + v;
}

function dims(f) {
  const r = settings.rotated[f.dev.id];
  return r ? { w: f.dev.h, h: f.dev.w } : { w: f.dev.w, h: f.dev.h };
}

function zoomValue() {
  if (settings.zoom !== 'fit') return parseFloat(settings.zoom);
  const avail = innerHeight - $('.bar').offsetHeight - (settings.view.ruler ? 110 : 90);
  let z = 1;
  for (const f of frames.values()) z = Math.min(z, avail / dims(f).h);
  return Math.max(0.1, Math.min(1, z));
}

function send(f, msg) {
  try {
    f.iframe.contentWindow.postMessage({ rv: 1, ...msg }, '*');
  } catch {}
}

function broadcast(msg, except) {
  for (const f of frames.values()) if (f !== except) send(f, msg);
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

function render() {
  const stage = $('#stage');
  stage.innerHTML = '';
  frames.clear();

  const list = visibleDevices();
  if (!list.length) {
    stage.innerHTML = `<p class="empty">${icon('layers', 'dim')}No devices in this tab. Use "Add device", or star a device in another tab.</p>`;
    return;
  }

  for (const dev of list) {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-head">
        <span class="meta">${icon(dev.type === 'tablet' || dev.type === 'desktop' ? dev.type : 'mobile', 'type')}<b></b><span class="dims"></span></span>
        <span class="tools">
          <button data-c="fav" class="fav" title="Show in Pinned" aria-label="Pin">${icon('star')}</button>
          <button data-c="rotate" title="Rotate" aria-label="Rotate">${icon('rotate')}</button>
          <button data-c="reload" title="Reload" aria-label="Reload">${icon('reload')}</button>
          <button data-c="shot" title="Screenshot" aria-label="Screenshot">${icon('camera')}</button>
          <button data-c="open" title="Open in a new tab" aria-label="Open in a new tab">${icon('external')}</button>
          <button data-c="remove" class="rm" title="Remove device" aria-label="Remove device">${icon('close')}</button>
        </span>
      </div>
      <div class="screen">
        <iframe allow="clipboard-read; clipboard-write; fullscreen; geolocation; camera; microphone"></iframe>
        <div class="overlay"></div>
        <div class="ruler h"></div>
        <div class="ruler v"></div>
      </div>`;
    $('b', card).textContent = dev.name;
    $('.fav', card).classList.toggle('on', !!dev.fav);

    const f = { dev, card, screen: $('.screen', card), iframe: $('iframe', card), url: '', loading: false };
    frames.set(dev.id, f);
    f.iframe.addEventListener('load', () => send(f, { cmd: 'hello', id: dev.id, opts: settings.opts }));
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (b) cardAction(f, b.dataset.c);
    });
    stage.appendChild(card);
  }

  layout();
  if (currentUrl) for (const f of frames.values()) load(f, currentUrl);
}

function layout(zOverride) {
  const z = zOverride || zoomValue();
  document.documentElement.style.setProperty('--z', z);
  for (const f of frames.values()) {
    const { w, h } = dims(f);
    f.card.style.width = w * z + 'px';
    f.screen.style.width = w * z + 'px';
    f.screen.style.height = h * z + 'px';
    f.iframe.style.width = w + 'px';
    f.iframe.style.height = h + 'px';
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

async function cardAction(f, c) {
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
      break;
    case 'reload':
      load(f, f.url || currentUrl);
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
      for (const f of frames.values()) load(f, f.url || currentUrl);
      break;
    case 'back':
    case 'forward': {
      // With navigation sync on, moving one is enough; the others follow.
      if (!settings.sync.nav) broadcast({ cmd: act });
      else {
        const first = frames.values().next().value;
        if (first) send(first, { cmd: act });
      }
      break;
    }
    case 'rotateAll': {
      const anyUnrotated = [...frames.values()].some((f) => !settings.rotated[f.dev.id]);
      for (const f of frames.values()) settings.rotated[f.dev.id] = anyUnrotated;
      save();
      layout();
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
  for (const x of frames.values()) if (x.iframe.contentWindow === e.source) f = x;
  if (!f) return;

  switch (d.type) {
    case 'ready':
      f.url = d.url;
      if (urlKey(d.url) === urlKey(currentUrl) && d.title) pageTitle = d.title;
      rememberIcon(d.url, d.icon);
      $('.card-head b', f.card).title = d.title || d.url;
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
      if (settings.sync.scroll) broadcast({ cmd: 'scroll', x: d.x, y: d.y }, f);
      break;
    case 'click':
      if (settings.sync.click) broadcast({ cmd: 'click', path: d.path }, f);
      break;
    case 'input':
      if (settings.sync.click) broadcast({ cmd: 'input', path: d.path, value: d.value }, f);
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
  $$('[data-opt]').forEach((b) => b.addEventListener('click', () => {
    settings.opts[b.dataset.opt] = !settings.opts[b.dataset.opt];
    save();
    syncToolbar();
    broadcast({ cmd: 'opts', opts: settings.opts });
  }));
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
  addEventListener('resize', () => settings.zoom === 'fit' && layout());

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
  try {
    await allowFraming();
  } catch (err) {
    toast('Warning: could not unblock iframes (' + err.message + ')');
  }
  bindUi();
  bindSites();
  syncToolbar();
  const fromQuery = new URLSearchParams(location.search).get('url');
  currentUrl = normalizeUrl(fromQuery || settings.lastUrl || '');
  $('#url').value = currentUrl;
  renderSites();
  render();
  if (!currentUrl) $('#url').focus();
})();
