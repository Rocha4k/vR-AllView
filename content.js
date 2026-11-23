// runs in every frame, idle until the viewer says hello
(() => {
  if (window.top === window) return;
  const ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  let frameId = null;
  let lastHref = location.href;
  let leading = false; // this frame drives the synced scroll
  let opts = {};
  let styleEl = null;
  let inspectBox = null;
  let flagged = []; // elements found by the overflow scan
  let scanTimer = 0;
  let lastScanKey = '';

  const post = (msg) => {
    if (frameId) parent.postMessage({ rv: 1, id: frameId, ...msg }, ORIGIN);
  };

  // favicon declared by the page, for sites the browser hasn't cached
  const iconHref = () => {
    const l = document.querySelector('link[rel~="icon" i], link[rel="apple-touch-icon" i]');
    return l && l.href ? l.href : location.origin + '/favicon.ico';
  };
  const ready = () => {
    post({ type: 'ready', url: location.href, title: document.title, icon: iconHref() });
    report();
  };

  const root = () => document.scrollingElement || document.documentElement;
  const maxX = () => Math.max(1, root().scrollWidth - innerWidth);
  const maxY = () => Math.max(1, root().scrollHeight - innerHeight);

  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        parts.unshift('#' + CSS.escape(el.id));
        break;
      }
      let i = 1;
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === el.tagName) i++;
      }
      // localName keeps svg casing (clipPath, linearGradient)
      parts.unshift(CSS.escape(el.localName) + ':nth-of-type(' + i + ')');
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function find(path) {
    try {
      return path ? document.querySelector(path) : null;
    } catch {
      return null;
    }
  }

  function describe(el) {
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.localName + (el.id ? '#' + el.id : '') + cls;
  }

  // svg elements have no .click()
  function fireClick(el) {
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
  }

  // page tools

  function applyOpts(next) {
    opts = next || {};
    document.designMode = opts.design ? 'on' : 'off';

    let css = '[data-allview-flash]{outline:3px solid #0a84ff!important;outline-offset:2px!important;transition:outline-color .2s}';
    if (opts.outline) css += '*{outline:1px solid rgba(255,40,100,.55)!important;outline-offset:-1px!important}';
    if (opts.noScrollbar) css += 'html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}';
    if (opts.overflow) css += '[data-allview-overflow]{outline:2px solid #ff3b30!important;outline-offset:-2px!important;background-color:rgba(255,59,48,.10)!important}';
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.dataset.rv = '1';
    }
    styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);

    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode !== styleEl) sheet.disabled = !!opts.noCss;
    }
    if (!opts.inspect && inspectBox) inspectBox.style.display = 'none';
    markOverflow();
  }

  function ensureInspectBox() {
    if (inspectBox) return inspectBox;
    inspectBox = document.createElement('div');
    inspectBox.innerHTML = '<div></div>';
    Object.assign(inspectBox.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: 2147483647,
      background: 'rgba(80,160,255,.14)', outline: '1px solid #3b8cff', display: 'none',
    });
    Object.assign(inspectBox.firstChild.style, {
      position: 'absolute', left: '-1px', top: '-22px', whiteSpace: 'nowrap',
      font: '11px/20px ui-monospace,Consolas,monospace', padding: '0 6px',
      background: '#ce3c33', color: '#fff',
    });
    document.documentElement.appendChild(inspectBox);
    return inspectBox;
  }

  // horizontal overflow

  // an ancestor clips it or pins it, so it cannot widen the page
  function clipped(el) {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === 'fixed' || cs.overflowX !== 'visible') return true;
    }
    return false;
  }

  function scanOverflow() {
    const vw = document.documentElement.clientWidth;
    const extra = Math.round(root().scrollWidth - vw);
    const found = [];
    if (extra > 1 && document.body) {
      const set = new Set();
      for (const el of document.body.getElementsByTagName('*')) {
        if (el === inspectBox || el.parentElement === inspectBox) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.right + scrollX <= vw + 1) continue;
        // only report the outermost culprit
        let inside = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (set.has(p)) { inside = true; break; }
        }
        if (inside || getComputedStyle(el).position === 'fixed' || clipped(el)) continue;
        set.add(el);
        found.push({ el, over: Math.round(r.right + scrollX - vw), width: Math.round(r.width) });
        if (found.length >= 40) break;
      }
    }
    flagged = found.map((x) => x.el);
    markOverflow();
    // siblings overflowing together blame their parent
    const groups = new Map();
    for (const x of found) {
      const p = x.el.parentElement;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(x);
    }
    const items = [];
    for (const [parent, list] of groups) {
      if (list.length > 1 && parent && parent !== document.body) {
        items.push({
          path: cssPath(parent),
          label: `${describe(parent)} › ${list.length} children`,
          over: Math.max(...list.map((x) => x.over)),
          width: Math.round(parent.scrollWidth),
        });
      } else {
        for (const x of list) items.push({ path: cssPath(x.el), label: describe(x.el), over: x.over, width: x.width });
      }
    }
    items.sort((a, b) => b.over - a.over);
    return { extra: Math.max(0, extra), items };
  }

  function markOverflow() {
    for (const el of document.querySelectorAll('[data-allview-overflow]')) {
      if (!opts.overflow || !flagged.includes(el)) el.removeAttribute('data-allview-overflow');
    }
    if (opts.overflow) for (const el of flagged) el.setAttribute('data-allview-overflow', '');
  }

  // media queries for the breakpoint bar

  function collectMedia() {
    const texts = new Set();
    const remote = new Set();
    const walkRules = (rules) => {
      for (const r of rules) {
        if (r instanceof CSSMediaRule) texts.add(r.media.mediaText);
        if (r instanceof CSSImportRule && r.styleSheet) walkSheet(r.styleSheet);
        if (r.cssRules) walkRules(r.cssRules);
      }
    };
    const walkSheet = (sheet) => {
      if (sheet.media && sheet.media.mediaText) texts.add(sheet.media.mediaText);
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        // cross-origin sheet, the viewer fetches it
        if (sheet.href) remote.add(sheet.href);
        return;
      }
      walkRules(rules);
    };
    for (const sheet of document.styleSheets) if (sheet.ownerNode !== styleEl) walkSheet(sheet);
    return { texts: [...texts], remote: [...remote] };
  }

  function report(force) {
    if (!frameId) return;
    const ovf = scanOverflow();
    const media = collectMedia();
    const key = JSON.stringify([ovf, media]);
    if (!force && key === lastScanKey) return;
    lastScanKey = key;
    post({ type: 'overflow', ...ovf });
    post({ type: 'media', ...media });
  }

  const scheduleReport = (ms = 400) => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => report(), ms);
  };

  // events

  addEventListener('mousemove', (e) => {
    if (!frameId || !opts.inspect) return;
    const el = e.target;
    if (!el || el === inspectBox) return;
    const r = el.getBoundingClientRect();
    const box = ensureInspectBox();
    Object.assign(box.style, {
      display: 'block', left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px',
    });
    const cs = getComputedStyle(el);
    box.firstChild.textContent =
      describe(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height) +
      '  ' + cs.fontSize + ' ' + cs.display;
    box.firstChild.style.top = r.top < 24 ? r.height + 2 + 'px' : '-22px';
  }, true);

  // only real user input makes this frame the scroll leader
  const lead = (e) => { if (e.isTrusted) leading = true; };
  for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    addEventListener(t, lead, { capture: true, passive: true });
  }

  let scrollQueued = false;
  addEventListener('scroll', () => {
    if (!frameId || !leading || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      if (leading) post({ type: 'scroll', x: scrollX / maxX(), y: scrollY / maxY() });
    });
  }, { passive: true });

  addEventListener('click', (e) => {
    if (!frameId || !e.isTrusted || opts.design) return;
    post({ type: 'click', path: cssPath(e.target) });
  }, true);

  addEventListener('input', (e) => {
    if (!frameId || !e.isTrusted || !('value' in e.target)) return;
    post({ type: 'input', path: cssPath(e.target), value: e.target.value });
  }, true);

  addEventListener('resize', () => frameId && scheduleReport(250));
  addEventListener('load', () => frameId && scheduleReport(100));

  function watchDom() {
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target;
        if (t === styleEl || t === inspectBox || (inspectBox && inspectBox.contains(t))) continue;
        if (r.type === 'attributes' && r.attributeName.startsWith('data-allview')) continue;
        scheduleReport(600);
        return;
      }
    });
    mo.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'],
    });
  }

  addEventListener('message', (e) => {
    const d = e.data;
    if (e.origin !== ORIGIN || e.source !== parent || !d || !d.rv) return;
    switch (d.cmd) {
      case 'hello': {
        const first = !frameId;
        frameId = d.id;
        applyOpts(d.opts);
        lastScanKey = '';
        ready();
        if (first) {
          watchDom();
          setTimeout(() => report(), 1500); // late fonts, images and lazy css
          // spa navigation doesn't fire load
          setInterval(() => {
            if (location.href !== lastHref) {
              lastHref = location.href;
              ready();
            }
          }, 400);
        }
        break;
      }
      case 'opts':
        applyOpts(d.opts);
        break;
      case 'scroll':
        leading = false;
        // instant, or smooth-scroll pages restart the animation on every message
        scrollTo({ left: d.x * maxX(), top: d.y * maxY(), behavior: 'instant' });
        break;
      case 'click': {
        const el = find(d.path);
        if (el) fireClick(el);
        break;
      }
      case 'input': {
        const el = find(d.path);
        if (el && 'value' in el && el.value !== d.value) {
          el.value = d.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        break;
      }
      case 'reveal': {
        const el = find(d.path);
        if (!el) break;
        leading = true;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.setAttribute('data-allview-flash', '');
        setTimeout(() => el.removeAttribute('data-allview-flash'), 1400);
        break;
      }
      case 'rescan':
        report(true);
        break;
      case 'back': history.back(); break;
      case 'forward': history.forward(); break;
      case 'html': {
        // strip our style tag and markers
        const copy = document.documentElement.cloneNode(true);
        copy.querySelectorAll('style[data-rv]').forEach((n) => n.remove());
        copy.querySelectorAll('[data-allview-overflow],[data-allview-flash]').forEach((n) => {
          n.removeAttribute('data-allview-overflow');
          n.removeAttribute('data-allview-flash');
        });
        post({ type: 'html', html: '<!doctype html>\n' + copy.outerHTML });
        break;
      }
    }
  });
})();
