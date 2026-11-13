const test = require('node:test');
const assert = require('node:assert');
const fixture = require('../smoke/fixture');
const { probe } = require('../smoke/probe');
const { createFakeElectron, loadMainWith } = require('./fake-electron');

const { runProbe, failing } = require('./probe-helpers');

test('probe passes against the real main.js control flow (toolbar IPC, menu, resize, guards, audio)', async () => {
  const { r, f } = await runProbe();
  assert.deepStrictEqual(failing(r), [], JSON.stringify(r.checks.filter((c) => !c.ok), null, 1));
  assert.ok(r.ok);
  assert.ok(r.checks.length >= 40, String(r.checks.length));
  assert.strictEqual(r.info.requestCounts['/'], 1); // single document load for the whole run
  assert.ok(r.info.steps.some((s) => s.mode === 'phone' && s.actual.width === 390));
  assert.ok(r.info.steps.some((s) => s.mode === 'tablet' && s.actual.width === 768));
  assert.deepStrictEqual(f.opened, []); // no external browser launches
  assert.ok(r.shots['desktop-remote'] && r.shots['tablet-remote'] && r.shots['phone-remote'] && r.shots['toolbar-minimum']);
});

test('probe exercises desktop/tablet/phone in order with all six transitions, clamping and the minimum window', async () => {
  const { r } = await runProbe();
  assert.deepStrictEqual(failing(r), []);
  const steps = r.info.steps;
  assert.deepStrictEqual(steps.map((s) => s.mode), ['desktop', 'tablet', 'phone', 'desktop', 'tablet', 'phone', 'phone', 'tablet', 'desktop', 'phone', 'phone', 'tablet', 'tablet', 'desktop']);
  for (const x of ['desktop>tablet', 'tablet>phone', 'phone>desktop', 'desktop>phone', 'phone>tablet', 'tablet>desktop']) assert.ok(r.info.transitions.includes(x), x);
  for (const s of steps) {
    assert.deepStrictEqual(s.actual, s.expected, s.step);
    assert.strictEqual(s.innerWidth, s.actual.width, s.step);
    assert.strictEqual(s.actual.height, s.content.h - 40, s.step); // full available height
    assert.deepStrictEqual(s.toolbarOn, [s.mode], s.step);
    if (s.mode === 'desktop') assert.strictEqual(s.actual.width, s.content.w, s.step);
    if (s.mode === 'tablet') assert.strictEqual(s.actual.width, Math.min(768, s.content.w), s.step);
    if (s.mode === 'phone') assert.strictEqual(s.actual.width, Math.min(390, s.content.w), s.step);
  }
  // Narrow (<768) tablet fills the available width; phone at the 420px window minimum stays 390 and centered.
  const narrowTablet = steps.filter((s) => s.mode === 'tablet' && s.content.w < 768);
  assert.ok(narrowTablet.length >= 2 && narrowTablet.every((s) => s.actual.width === s.content.w && s.actual.x === 0));
  assert.deepStrictEqual(r.info.minimumContentSize, { w: 404, h: 761 });
  const minPhone = steps.find((s) => s.step.startsWith('11 '));
  assert.deepStrictEqual(minPhone.actual, { x: 7, y: 40, width: 390, height: 721 });
  assert.deepStrictEqual(r.info.modeMenu, [{ label: '데스크톱 모드', accelerator: 'CmdOrCtrl+1' },
    { label: '태블릿 모드', accelerator: 'CmdOrCtrl+2' }, { label: '휴대폰 모드', accelerator: 'CmdOrCtrl+3' }]);
  assert.deepStrictEqual(r.info.toolbar.ids, ['back', 'reload', 'desktop', 'tablet', 'phone', 'print']);
  assert.strictEqual(r.info.toolbarAtMinimum.viewportWidth, 404);
  assert.strictEqual(r.info.requestCounts['/'], 1);
});

test('probe detects a reload on switching to tablet', async () => {
  const { r } = await runProbe({ onSetBounds: (v, b) => { if (v.webContents.doc && b.width === 768) v.webContents.doc = { loadId: 'reloaded' }; } });
  assert.ok(!r.ok);
  assert.ok(failing(r).some((n) => /태블릿.*no reload/.test(n)), failing(r).join('\n'));
});

test('probe detects a wrong tablet viewport width (e.g. phone width or not 768)', async () => {
  for (const bad of [390, 760, 800]) {
    const { r } = await runProbe({ onSetBounds: (v, b) => { if (b.width === 768) v.bounds = { ...b, width: bad }; } });
    assert.ok(!r.ok, String(bad));
    assert.ok(failing(r).some((n) => /real tablet viewport/.test(n)), String(bad));
  }
});

test('probe detects tablet not clamped in a narrow window', async () => {
  // A shell that keeps 768 (overflowing) instead of min(768, available) at 700px content width.
  const { r } = await runProbe({ onSetBounds: (v, b) => { if (!v.webContents.isToolbar && b.x === 0 && b.width === 700) v.bounds = { ...b, width: 768 }; } });
  assert.ok(failing(r).some((n) => /^8 .*real tablet viewport/.test(n)), failing(r).join('\n'));
});

test('probe detects toolbar overflow at the minimum window width (six buttons)', async () => {
  const { r } = await runProbe({ toolbarFitWidth: 500 });
  assert.ok(!r.ok);
  assert.deepStrictEqual(failing(r), ['11 minimum width: toolbar fits (no overflow, no clipped button text, every button visible)']);
});

test('probe detects an icon-only toolbar button without an accessible name/tooltip', async () => {
  const names = ['back', 'reload', 'desktop', 'tablet', 'phone', 'print'].map((id) => ({ id, label: id === 'print' ? '' : id, title: id === 'reload' ? '' : id }));
  const { r } = await runProbe({ toolbarNames: names });
  assert.ok(failing(r).some((n) => /accessible name and tooltip/.test(n)));
});

test('probe detects the old 2-mode menu mapping (phone on Ctrl+2, no tablet)', async () => {
  const { r } = await runProbe({}, {}, (f) => {
    const view = f.electron.Menu.getApplicationMenu().items.find((i) => i.label === '보기');
    view.submenu.items = view.submenu.items.filter((i) => i.label !== '태블릿 모드');
    view.submenu.items.find((i) => i.label === '휴대폰 모드').accelerator = 'CmdOrCtrl+2';
  });
  assert.ok(!r.ok);
  assert.ok(failing(r).some((n) => /보기 menu is exactly/.test(n)));
});

test('installed-exe mode: initial blocked load, then fixture via router on the trusted origin', async () => {
  // Simulate the installed app: router is NOT present at first load, probe installs it afterwards.
  const f = createFakeElectron({ origin: fixture.TRUSTED_ORIGIN, wavPath: fixture.WAV_PATH });
  globalThis.__orunSmoke = undefined;
  loadMainWith(f.electron);
  f.fireReady();
  await new Promise((r) => setTimeout(r, 20));
  const r = await probe(f.electron, fixture.probeOptions({ label: 'mock-installed', timeScale: 0.02, reloadAfterIntercept: true }));
  assert.deepStrictEqual(failing(r), []);
  assert.strictEqual(r.info.initialUrlBeforeFixture, 'chrome-error://chromewebdata/');
});

test('probe detects a reload on mode switch', async () => {
  const { r } = await runProbe({ onSetBounds: (v, b) => { if (v.webContents.doc && b.width === 390) v.webContents.doc = { loadId: 'reloaded' }; } });
  assert.ok(!r.ok);
  assert.ok(failing(r).some((n) => /no reload/.test(n)), failing(r).join('\n'));
});

test('probe detects a wrong phone viewport width', async () => {
  const { r } = await runProbe({ onSetBounds: (v, b) => { if (b.width === 390) v.bounds = { ...b, width: 400, x: b.x - 5 }; } });
  assert.ok(!r.ok);
  assert.ok(failing(r).some((n) => /real phone viewport/.test(n)));
});

test('router serves only the trusted origin; other https requests get 403', async () => {
  const { r, f } = await runProbe();
  assert.ok(r.ok);
  const h = f.electron.session.fromPartition(fixture.PARTITION).handlers.https;
  assert.strictEqual((await h(new Request('https://evil.example/'))).status, 403);
  assert.strictEqual((await h(new Request('https://www.orunvoca.co.kr/'))).status, 403);
  assert.strictEqual((await h(new Request('https://orunvoca.co.kr/missing'))).status, 404);
});

test('probe is self-contained (survives fn.toString() serialization used by the installed-app inspector driver in a fresh context)', async () => {
  const vm = require('node:vm');
  const sandbox = { setTimeout, Buffer, Response, Request, URL, process, JSON, Math, Date, Promise, Error, String, Object, Array };
  sandbox.globalThis = sandbox;
  const revived = vm.runInNewContext('(' + probe.toString() + ')', sandbox);
  const f = createFakeElectron({ origin: fixture.TRUSTED_ORIGIN, wavPath: fixture.WAV_PATH });
  let p;
  f.electron.app.whenReady().then(() => { p = revived(f.electron, fixture.probeOptions({ label: 'revived', timeScale: 0.02 })); });
  loadMainWith(f.electron);
  f.fireReady();
  await new Promise((r) => setImmediate(r));
  const r = await p;
  assert.strictEqual(JSON.stringify(failing(r)), '[]');
  assert.strictEqual(r.ok, true);
});

