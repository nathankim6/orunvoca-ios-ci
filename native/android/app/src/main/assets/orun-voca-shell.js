// Native-feel layer for the trusted orunvoca.co.kr main frame only. Reads computed styles to
// report the colours painted at the top and bottom edges so the native system-bar strips
// match the page. Never reads, stores or sends page content.
(() => {
  if (window !== window.top || location.origin !== 'https://orunvoca.co.kr' || window.__orunVocaShellReady) return;
  window.__orunVocaShellReady = true;
  const bridge = window.__orunVocaShell;
  if (!bridge) return;
  const root = document.documentElement;
  root.setAttribute('data-native-app', 'android');
  const style = document.createElement('style');
  style.textContent = 'html{-webkit-tap-highlight-color:transparent}' +
    'button,nav,label,[role=button],[role=tab],[role=menuitem],.login-submit,.login-google{-webkit-user-select:none;user-select:none}';
  (document.head || root).appendChild(style);
  const parse = value => {
    const m = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return (p.length < 4 || p[3] >= 0.9) ? p.slice(0, 3).map(Math.round) : null;
  };
  const at = (y, x = innerWidth / 2) => {
    let el = document.elementFromPoint(x, y);
    while (el && el !== root) { const c = parse(getComputedStyle(el).backgroundColor); if (c) return c; el = el.parentElement; }
    return document.body ? parse(getComputedStyle(document.body).backgroundColor) : null;
  };
  let last = '', timer = 0;
  const report = (delay = 80) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Bottom: sample the page edge (x=2), not a centred button that happens to sit there.
      const top = at(2) || at(14), bottom = at(innerHeight - 2, 2) || top;
      if (!top) return;
      const message = JSON.stringify({ top, bottom });
      if (message === last) return;
      last = message;
      bridge.postMessage(message);
    }, delay);
  };
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function () { const result = original.apply(this, arguments); report(260); return result; };
  }
  addEventListener('popstate', () => report(260));
  addEventListener('resize', () => report(160));
  addEventListener('scroll', () => report(220), true);
  const start = () => {
    report(0);
    new MutationObserver(() => report(120)).observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const app = document.getElementById('root');
    if (app) new MutationObserver(() => report(200)).observe(app, { childList: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  addEventListener('load', () => { report(0); setTimeout(() => report(0), 700); });
})();
