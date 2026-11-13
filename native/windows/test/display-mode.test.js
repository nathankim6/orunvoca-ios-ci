'use strict';
// Desktop / tablet / phone display modes: wiring, accessibility, narrow-window toolbar, stable identity, print regression.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const fixture = require('../smoke/fixture');
const { createFakeElectron, loadMainWith } = require('./fake-electron');

const src = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const MODES = ['desktop', 'tablet', 'phone'];
const SITE = 'https://orunvoca.co.kr/test-paper/create';

test('main.js: 보기 menu is 데스크톱/태블릿/휴대폰 on Ctrl+1/2/3; no new IPC, timers or extra menus', () => {
  const m = src('main.js');
  const view = m.slice(m.indexOf("{ label: '보기'"), m.indexOf(']));'));
  const items = [...view.matchAll(/\{ label: '([^']+)', accelerator: '([^']+)', click: \(\) => setMode\('(\w+)'\) \}/g)].map((x) => x.slice(1));
  assert.deepStrictEqual(items, [['데스크톱 모드', 'CmdOrCtrl+1', 'desktop'], ['태블릿 모드', 'CmdOrCtrl+2', 'tablet'], ['휴대폰 모드', 'CmdOrCtrl+3', 'phone']]);
  assert.strictEqual((m.match(/accelerator: 'CmdOrCtrl\+[123]'/g) || []).length, 3);
  assert.strictEqual((m.match(/ipcMain\.on\(/g) || []).length, 4);
  assert.ok(!/setTimeout|setInterval/.test(m));
  const menuSrc = m.slice(m.indexOf('function buildMenu'), m.indexOf('function createWindow'));
  assert.ok(!/오프라인|단어장|사이드|노트|sidebar|notebook|offline/i.test(menuSrc));
  assert.deepStrictEqual([...menuSrc.matchAll(/^    \{ label: '([^']+)', submenu/gm)].map((x) => x[1]), ['탐색', '보기']);
  assert.strictEqual((m.match(/new WebContentsView/g) || []).length, 2);
  assert.match(m, /function setMode\(m\) \{ mode = layout\.normalizeMode\(m\); applyLayout\(\); \}/);
  const applyLayout = m.slice(m.indexOf('function applyLayout'), m.indexOf('function setMode'));
  assert.ok(!/loadURL|loadFile|reload|new WebContentsView|removeChildView|addChildView|destroy/.test(applyLayout), 'mode change never reloads or recreates views');
  assert.match(applyLayout, /remoteView\.setBounds\(layout\.computeRemoteBounds\(mode, w, h\)\)/);
  // Relayout on window resize AND on the content view's own layout (client area can change without a resize).
  assert.match(m, /win\.on\('resize', applyLayout\);/);
  assert.match(m, /win\.contentView\.on\('bounds-changed', applyLayout\);/);
  // Secure print popup support is untouched.
  assert.match(m, /sec\.isPrintPopupRequest\(details, wc\.getURL\(\), printPopups\.size\)/);
  assert.match(m, /wc\.on\('did-create-window', \(child, details\) => hardenPrintPopup\(child, details\)\)/);
});

test('toolbar.html: six buttons back, reload, desktop, tablet, phone, print with accessible names', () => {
  const h = src('toolbar.html');
  assert.deepStrictEqual([...h.matchAll(/<button id="(\w+)"/g)].map((x) => x[1]), ['back', 'reload', 'desktop', 'tablet', 'phone', 'print']);
  const btn = (id) => h.match(new RegExp(`<button id="${id}"[^>]*>[\\s\\S]*?</button>`))[0];
  for (const [id, label, shortcut] of [['back', '뒤로', 'Alt+←'], ['reload', '새로고침', 'Ctrl+R'], ['print', '인쇄', 'Ctrl+P']]) {
    const b = btn(id);
    assert.match(b, /class="cmp"/, id);
    assert.match(b, new RegExp(`aria-label="${label}"`), id);
    assert.match(b, new RegExp(`title="${label} \\(${shortcut.replace('+', '\\+')}\\)"`), id);
    assert.match(b, /<span class="ic" aria-hidden="true"><svg/, id);
    assert.match(b, new RegExp(`<span class="lb">${label}</span>`), id);
  }
  for (const [id, label, n] of [['desktop', '데스크톱', 1], ['tablet', '태블릿', 2], ['phone', '휴대폰', 3]]) {
    const b = btn(id);
    assert.ok(!/class="cmp"/.test(b), `${id} keeps its text`);
    assert.match(b, new RegExp(`>${label}</button>$`), id);
    assert.match(b, new RegExp(`title="${label} 모드 \\(Ctrl\\+${n}\\)"`), id);
    assert.match(b, /aria-pressed="false"/, id);
  }
  assert.match(h, /role="group" aria-label="화면 모드"/);
  // CSP unchanged; inline SVG only, no external resources.
  assert.match(h, /content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self'"/);
  assert.deepStrictEqual([...h.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((x) => x[1]), ['toolbar.js']);
  assert.ok(!/노트|단어장|사이드|sidebar|notebook|note/i.test(h.replace(/<style>[\s\S]*<\/style>/, '')));
});

test('toolbar.html: narrow windows switch back/reload/print to icon-only; nothing wraps, shrinks or truncates', () => {
  const h = src('toolbar.html');
  const css = h.match(/<style>([\s\S]*?)<\/style>/)[1];
  const mq = css.match(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/);
  assert.ok(mq, 'compact media query');
  const bp = Number(mq[1]);
  assert.ok(bp >= 440 && bp <= 640, `breakpoint ${bp}`);
  assert.match(mq[2], /button\.cmp \.lb\{display:none\}/);
  assert.match(mq[2], /button\.cmp \.ic\{display:inline-flex\}/);
  assert.match(css, /\.ic\{display:none;/);
  assert.match(css, /button\{[^}]*white-space:nowrap[^}]*flex:0 0 auto/);
  assert.match(css, /\.modes\{[^}]*flex:0 0 auto/);
  assert.match(css, /\.sp\{flex:1 1 0;min-width:0\}/);
  assert.ok(!/text-overflow|ellipsis/.test(css), 'labels are never ellipsized');

  // Conservative width estimate (Malgun Gothic Hangul ~1em = 13px, borders 1px) for the 420px window
  // minimum (404px content) and for the first width that uses the full-text layout.
  const num = (re, s = css) => Number(s.match(re)[1]);
  const hangul = (t) => [...t].length * 13;
  const full = { gap: num(/body\{[^}]*gap:(\d+)px/), pad: num(/body\{[^}]*padding:0 (\d+)px/), bpad: num(/button\{[^}]*padding:0 (\d+)px/), mgap: num(/\.modes\{[^}]*gap:(\d+)px/) };
  const cmp = { gap: num(/body\{gap:(\d+)px/, mq[2]), pad: num(/body\{[^}]*padding:0 (\d+)px/, mq[2]), bpad: num(/button\{padding:0 (\d+)px\}/, mq[2]), icon: num(/button\.cmp\{width:(\d+)px/, mq[2]) };
  const modes = (bpad, mgap) => ['데스크톱', '태블릿', '휴대폰'].reduce((a, t) => a + hangul(t) + 2 * bpad + 2, 0) + 2 * mgap;
  // Flex items: back, reload, spacer, modes, spacer, print -> 5 gaps.
  const compactWidth = 3 * cmp.icon + modes(cmp.bpad, full.mgap) + 5 * cmp.gap + 2 * cmp.pad;
  const fullWidth = ['뒤로', '새로고침', '인쇄'].reduce((a, t) => a + hangul(t) + 2 * full.bpad + 2, 0) + modes(full.bpad, full.mgap) + 5 * full.gap + 2 * full.pad;
  assert.ok(compactWidth <= 404 - 40, `compact toolbar needs ~${compactWidth}px of 404px`);
  assert.ok(fullWidth <= bp + 1 - 40, `full toolbar needs ~${fullWidth}px but is used from ${bp + 1}px`);
});

test('preload: only exact desktop/tablet/phone reach the main process; anything else becomes desktop', () => {
  const sent = []; let api;
  const electron = { contextBridge: { exposeInMainWorld: (k, v) => { assert.strictEqual(k, 'orunShell'); api = v; } },
    ipcRenderer: { send: (...a) => sent.push(a), on() {} } };
  const p = require.resolve('../src/preload.js'); delete require.cache[p];
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? electron : orig.call(this, req, ...rest); };
  try { require(p); } finally { Module._load = orig; }
  for (const m of [...MODES, 'Tablet', ' tablet', 'ipad', '', null, undefined, 2, '__proto__']) api.setMode(m);
  assert.deepStrictEqual(sent.map((a) => a[1]), ['desktop', 'tablet', 'phone', 'desktop', 'desktop', 'desktop', 'desktop', 'desktop', 'desktop', 'desktop', 'desktop']);
  assert.ok(sent.every((a) => a[0] === 'shell:set-mode' && a.length === 2));
  assert.deepStrictEqual(Object.keys(api).sort(), ['back', 'onMode', 'print', 'reload', 'setMode']);
});

test('toolbar.js: each mode button sends its own mode and exactly one button is pressed', () => {
  const els = {}; const calls = []; let onMode;
  for (const id of ['back', 'reload', 'print', ...MODES]) {
    const cls = new Set(); const attrs = {};
    els[id] = { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: (c) => cls.has(c) }, setAttribute: (k, v) => { attrs[k] = v; }, attrs };
  }
  const orunShell = { setMode: (m) => calls.push(['mode', m]), back: () => calls.push(['back']), reload: () => calls.push(['reload']), print: () => calls.push(['print']), onMode: (cb) => { onMode = cb; } };
  vm.runInNewContext(src('toolbar.js'), { document: { getElementById: (id) => els[id] }, orunShell });
  for (const id of ['back', 'reload', 'desktop', 'tablet', 'phone', 'print']) els[id].onclick();
  assert.deepStrictEqual(calls, [['back'], ['reload'], ['mode', 'desktop'], ['mode', 'tablet'], ['mode', 'phone'], ['print']]);
  for (const mode of ['tablet', 'phone', 'desktop', 'tablet', 'bogus']) {
    onMode(mode);
    for (const m of MODES) {
      assert.strictEqual(els[m].classList.has('on'), m === mode, `${mode}:${m}`);
      assert.strictEqual(els[m].attrs['aria-pressed'], String(m === mode));
    }
  }
});

function boot() {
  const f = createFakeElectron({ origin: fixture.TRUSTED_ORIGIN, wavPath: fixture.WAV_PATH });
  loadMainWith(f.electron);
  f.fireReady();
  return f;
}
const settle = () => new Promise((r) => setTimeout(r, 10));
const parts = (f) => {
  const win = f.electron.BaseWindow.getAllWindows()[0];
  const kids = win.contentView.children;
  const toolbar = kids.find((v) => v.webContents.isToolbar); const remote = kids.find((v) => !v.webContents.isToolbar);
  return { win, kids, toolbar, remote, rwc: remote.webContents, twc: toolbar.webContents };
};
const viewMenu = (f) => f.electron.Menu.getApplicationMenu().items.find((i) => i.label === '보기').submenu.items;

test('fake runtime: toolbar IPC and Ctrl+1/2/3 menu switch real bounds on the same view, session and page', async () => {
  const f = boot(); await settle();
  const { win, kids, toolbar, remote, rwc, twc } = parts(f);
  rwc.url = SITE; rwc.doc = { loadId: 'STABLE' };
  let loads = 0;
  const origLoad = rwc.loadURL.bind(rwc); rwc.loadURL = (...a) => { loads++; return origLoad(...a); };
  const origReload = rwc.reload.bind(rwc); rwc.reload = () => { loads++; return origReload(); };
  const id = rwc.id, ses = rwc.session, pid = rwc.getOSProcessId();
  const [w, h] = win.getContentSize();
  const want = { desktop: { x: 0, y: 40, width: w, height: h - 40 }, tablet: { x: Math.floor((w - 768) / 2), y: 40, width: 768, height: h - 40 },
    phone: { x: Math.floor((w - 390) / 2), y: 40, width: 390, height: h - 40 } };
  const items = viewMenu(f);
  assert.deepStrictEqual(items.map((i) => [i.label, i.accelerator]), [['데스크톱 모드', 'CmdOrCtrl+1'], ['태블릿 모드', 'CmdOrCtrl+2'], ['휴대폰 모드', 'CmdOrCtrl+3']]);
  const seq = ['tablet', 'phone', 'desktop', 'phone', 'tablet', 'desktop', 'tablet'];
  for (const [i, m] of seq.entries()) {
    if (i % 2) items[MODES.indexOf(m)].click(); else f.electron.ipcMain.emit('shell:set-mode', { sender: twc }, m);
    assert.deepStrictEqual(remote.getBounds(), want[m], m);
    assert.strictEqual(twc.toolbarMode, m);
    assert.deepStrictEqual(toolbar.getBounds(), { x: 0, y: 0, width: w, height: 40 });
  }
  // Foreign sender (remote page) cannot switch modes; invalid values fall back to desktop.
  f.electron.ipcMain.emit('shell:set-mode', { sender: rwc }, 'phone');
  assert.deepStrictEqual(remote.getBounds(), want.tablet);
  f.electron.ipcMain.emit('shell:set-mode', { sender: twc }, 'TABLET');
  assert.deepStrictEqual(remote.getBounds(), want.desktop);
  // Resize keeps the current mode; narrow window clamps tablet to the available width.
  f.electron.ipcMain.emit('shell:set-mode', { sender: twc }, 'tablet');
  win.setContentSize(700, h);
  assert.deepStrictEqual(remote.getBounds(), { x: 0, y: 40, width: 700, height: h - 40 });
  win.setSize(1, 1); // clamped to minWidth 420 / minHeight 500
  assert.deepStrictEqual(win.getContentSize(), [404, 461]);
  assert.deepStrictEqual(remote.getBounds(), { x: 0, y: 40, width: 404, height: 421 });
  items[2].click();
  assert.deepStrictEqual(remote.getBounds(), { x: 7, y: 40, width: 390, height: 421 });
  // Stable identity throughout.
  assert.strictEqual(parts(f).remote, remote); assert.strictEqual(parts(f).rwc, rwc);
  assert.ok(rwc.id === id && rwc.session === ses && rwc.getOSProcessId() === pid && rwc.session === f.electron.session.fromPartition('persist:orunvoca'));
  assert.strictEqual(kids.length, 2);
  assert.strictEqual(f.electron.BaseWindow.getAllWindows().length, 1);
  assert.strictEqual(loads, 0, 'no reload / re-navigation on mode switch');
  assert.strictEqual(rwc.doc.loadId, 'STABLE');
  assert.strictEqual(rwc.url, SITE);
});

test('fake runtime: no outer sidebar/offline menus; top level stays 탐색, 보기', async () => {
  const f = boot(); await settle();
  const menu = f.electron.Menu.getApplicationMenu();
  assert.deepStrictEqual(menu.items.map((i) => i.label), ['탐색', '보기']);
  const labels = [];
  const walk = (items) => { for (const i of items) { if (i.label) labels.push(i.label); if (i.submenu) walk(i.submenu.items); } };
  walk(menu.items);
  assert.deepStrictEqual(labels, ['탐색', '뒤로', '새로고침', '인쇄...', '종료', '보기', '데스크톱 모드', '태블릿 모드', '휴대폰 모드']);
});

test('print regression: in every mode the trusted single about:blank print popup still works and stays hardened', async () => {
  const f = boot(); await settle();
  const { rwc, twc, remote } = parts(f);
  rwc.url = SITE;
  const printed = []; rwc.print = (o) => printed.push(o);
  const printItem = f.electron.Menu.getApplicationMenu().items[0].submenu.items.find((i) => i.label === '인쇄...');
  assert.strictEqual(printItem.accelerator, 'CmdOrCtrl+P');
  for (const m of [...MODES, 'tablet']) {
    f.electron.ipcMain.emit('shell:set-mode', { sender: twc }, m);
    const w = rwc.windowOpen('about:blank');
    assert.ok(w && !w.destroyed && w.menuRemoved, `${m}: popup allowed`);
    assert.strictEqual(w.webContents.prefs.preload, undefined);
    assert.ok(w.webContents.prefs.sandbox && w.webContents.prefs.contextIsolation && !w.webContents.prefs.nodeIntegration);
    assert.strictEqual(w.webContents.openHandler({ url: 'about:blank' }).action, 'deny', `${m}: nested popup denied`);
    const nav = { prevented: false, preventDefault() { this.prevented = true; } };
    w.webContents.emit('will-navigate', nav, 'https://orunvoca.co.kr/');
    assert.ok(nav.prevented, `${m}: popup navigation blocked`);
    assert.strictEqual(rwc.windowOpen('about:blank'), null, `${m}: limit 1`);
    // Switching modes while the popup is open neither closes it nor opens another.
    f.electron.ipcMain.emit('shell:set-mode', { sender: twc }, MODES[(MODES.indexOf(m) + 1) % 3]);
    assert.ok(!w.destroyed);
    assert.strictEqual(f.electron.BaseWindow.getAllWindows().length, 2);
    assert.strictEqual(rwc.windowOpen('about:blank'), null);
    w.close();
    assert.strictEqual(f.electron.BaseWindow.getAllWindows().length, 1, `${m}: slot released`);
    f.electron.ipcMain.emit('shell:print', { sender: twc });
    printItem.click();
    f.electron.ipcMain.emit('shell:print', { sender: rwc }); // foreign sender ignored
  }
  assert.strictEqual(printed.length, 8);
  assert.ok(printed.every((o) => o && o.printBackground === true));
  // Untrusted popups stay denied regardless of mode.
  f.electron.ipcMain.emit('shell:set-mode', { sender: twc }, 'phone');
  assert.strictEqual(rwc.windowOpen('https://orunvoca.co.kr/other'), null);
  assert.strictEqual(rwc.windowOpen('about:blank#x'), null);
  rwc.url = 'https://www.orunvoca.co.kr/';
  assert.strictEqual(rwc.windowOpen('about:blank'), null);
  assert.deepStrictEqual(f.opened, []);
  assert.strictEqual(parts(f).remote, remote);
});

test('fake runtime: client area shrinking without a window resize (menu bar) re-lays out every mode', async () => {
  const f = createFakeElectron({ origin: fixture.TRUSTED_ORIGIN, wavPath: fixture.WAV_PATH });
  loadMainWith(f.electron);
  f.fireReady(); await settle();
  const { win, remote, rwc, twc, toolbar } = parts(f);
  let resizes = 0; win.on('resize', () => resizes++);
  for (const m of MODES) {
    f.electron.ipcMain.emit('shell:set-mode', { sender: twc }, m);
    const [w, h] = win.getContentSize();
    win.size = [w, h - 26]; // client area only; no 'resize'
    assert.strictEqual(remote.getBounds().height, h - 40, `${m}: stale until the content view reports its layout`);
    win.contentView.emit('bounds-changed');
    const want = { desktop: w, tablet: Math.min(768, w), phone: Math.min(390, w) }[m];
    assert.deepStrictEqual(remote.getBounds(), { x: Math.floor((w - want) / 2), y: 40, width: want, height: h - 26 - 40 }, m);
    assert.deepStrictEqual(toolbar.getBounds(), { x: 0, y: 0, width: w, height: 40 });
    assert.strictEqual(twc.toolbarMode, m);
  }
  assert.strictEqual(resizes, 0);
  assert.strictEqual(parts(f).rwc, rwc);
});
