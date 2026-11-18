// Runs in every iframe, but only wakes up after the extension viewer sends
// "hello". On normal pages it does nothing.
(() => {
  if (window.top === window) return;
  const ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  let frameId = null;
  let lastHref = location.href;
  let ignoreScrollUntil = 0;
  let opts = {};
  let styleEl = null;
  let inspectBox = null;

  const post = (msg) => {
    if (frameId) parent.postMessage({ rv: 1, id: frameId, ...msg }, ORIGIN);
  };

  // Favicon declared by the page (useful for local sites the browser doesn't know yet).
  const iconHref = () => {
    const l = document.querySelector('link[rel~="icon" i], link[rel="apple-touch-icon" i]');
    return l && l.href ? l.href : location.origin + '/favicon.ico';
  };
  const ready = () => post({ type: 'ready', url: location.href, title: document.title, icon: iconHref() });

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
      // localName keeps the case of SVG elements (clipPath, linearGradient...).
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

  // SVG elements (icons inside buttons, charts...) have no .click().
  function fireClick(el) {
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
  }

  function applyOpts(next) {
    opts = next || {};
    document.designMode = opts.design ? 'on' : 'off';

    let css = '';
    if (opts.outline) css += '*{outline:1px solid rgba(255,40,100,.55)!important;outline-offset:-1px!important}';
    if (opts.noScrollbar) css += 'html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}';
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
      background: '#ce3c33', color: '#fff', borderRadius: '0',
    });
    document.documentElement.appendChild(inspectBox);
    return inspectBox;
  }

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
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const cs = getComputedStyle(el);
    box.firstChild.textContent =
      el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls +
      '  ' + Math.round(r.width) + '×' + Math.round(r.height) +
      '  ' + cs.fontSize + ' ' + cs.display;
    box.firstChild.style.top = r.top < 24 ? r.height + 2 + 'px' : '-22px';
  }, true);

  addEventListener('scroll', () => {
    if (!frameId || Date.now() < ignoreScrollUntil) return;
    post({ type: 'scroll', x: scrollX / maxX(), y: scrollY / maxY() });
  }, { passive: true });

  addEventListener('click', (e) => {
    if (!frameId || !e.isTrusted || opts.design) return;
    post({ type: 'click', path: cssPath(e.target) });
  }, true);

  addEventListener('input', (e) => {
    if (!frameId || !e.isTrusted || !('value' in e.target)) return;
    post({ type: 'input', path: cssPath(e.target), value: e.target.value });
  }, true);

  addEventListener('message', (e) => {
    const d = e.data;
    if (e.origin !== ORIGIN || e.source !== parent || !d || !d.rv) return;
    switch (d.cmd) {
      case 'hello': {
        const first = !frameId;
        frameId = d.id;
        applyOpts(d.opts);
        ready();
        if (first) {
          // SPA navigation (pushState) does not fire "load" on the iframe.
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
        ignoreScrollUntil = Date.now() + 120;
        scrollTo(d.x * maxX(), d.y * maxY());
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
      case 'back': history.back(); break;
      case 'forward': history.forward(); break;
      case 'html':
        post({ type: 'html', html: '<!doctype html>\n' + document.documentElement.outerHTML });
        break;
    }
  });
})();
