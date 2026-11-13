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
  assert.deepStrictEqual(f.opened, []); // no external browser launches
  assert.ok(r.shots['desktop-remote'] && r.shots['phone-remote']);
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

