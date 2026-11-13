const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/security');
const fixture = require('../smoke/fixture');
const { createFakeElectron, loadMainWith } = require('./fake-electron');
const { runProbe, failing } = require('./probe-helpers');

const SITE = 'https://orunvoca.co.kr/test-paper/create';
const ok = { url: 'about:blank', disposition: 'foreground-tab', frameName: '_blank' };

test('policy: only window.open("", "_blank") from the exact trusted page, one at a time', () => {
  assert.ok(S.isPrintPopupRequest(ok, SITE, 0));
  assert.ok(S.isPrintPopupRequest({ ...ok, disposition: 'new-window' }, SITE, 0));
  assert.ok(S.isPrintPopupRequest({ ...ok, url: '' }, SITE, 0), 'window.open("") reported as empty URL');
  for (const url of [undefined, null, ' ', 'about:blank#x', 'about:blank?x', 'ABOUT:BLANK', 'about:srcdoc', 'https://orunvoca.co.kr/', 'https://orunvoca.co.kr/print', 'http://example.com/', 'javascript:1', 'data:text/html,x', 'file:///C:/x'])
    assert.ok(!S.isPrintPopupRequest({ ...ok, url }, SITE, 0), url);
  for (const disposition of ['background-tab', 'other', 'save-to-disk', undefined])
    assert.ok(!S.isPrintPopupRequest({ ...ok, disposition }, SITE, 0), String(disposition));
  assert.ok(!S.isPrintPopupRequest({ ...ok, postBody: { data: [] } }, SITE, 0));
  for (const opener of ['https://u:p@orunvoca.co.kr/', 'https://u@orunvoca.co.kr/', 'http://orunvoca.co.kr/', 'https://www.orunvoca.co.kr/',
    'https://orunvoca.co.kr.evil.com/', 'chrome-error://chromewebdata/', 'about:blank', '', undefined])
    assert.ok(!S.isPrintPopupRequest(ok, opener, 0), String(opener));
  for (const n of [1, 2, -1, 0.5, NaN, undefined]) assert.ok(!S.isPrintPopupRequest(ok, SITE, n), String(n));
  assert.ok(!S.isPrintPopupRequest(null, SITE, 0));
  assert.strictEqual(S.PRINT_POPUP_LIMIT, 1);
});
test('policy: credential-bearing site URLs are not trusted (URL.origin ignores credentials)', () => {
  assert.strictEqual(new URL('https://u:p@orunvoca.co.kr/').origin, S.SITE_ORIGIN); // why the explicit check is needed
  for (const u of ['https://u:p@orunvoca.co.kr/', 'https://u@orunvoca.co.kr/x', 'https://:p@orunvoca.co.kr/']) {
    assert.ok(!S.isSiteUrl(u), u);
    assert.ok(!S.isAllowedNavigation(u), u);
  }
  assert.ok(S.isAllowedNavigation('https://orunvoca.co.kr/a?b=1#c'));
});
test('policy: post-create check requires about:blank AND the exact inherited site origin', () => {
  assert.ok(S.isTrustedPrintPopup('about:blank', S.SITE_ORIGIN));
  assert.ok(S.isTrustedPrintPopup('', S.SITE_ORIGIN));
  for (const [u, o] of [['about:blank', 'null'], ['about:blank', 'https://evil.example'], ['about:blank', 'https://www.orunvoca.co.kr'],
    ['about:blank', ''], ['', 'null'], ['https://orunvoca.co.kr/', S.SITE_ORIGIN], ['about:blank#x', S.SITE_ORIGIN], [undefined, S.SITE_ORIGIN]])
    assert.ok(!S.isTrustedPrintPopup(u, o), `${u} ${o}`);
});
test('policy: popup window options are hardened, preload-free and a fresh copy each time', () => {
  const a = S.printPopupWindowOptions(); const b = S.printPopupWindowOptions();
  assert.notStrictEqual(a, b); assert.notStrictEqual(a.webPreferences, b.webPreferences);
  const w = a.webPreferences;
  assert.deepStrictEqual([w.sandbox, w.contextIsolation, w.nodeIntegration, w.webSecurity, w.nodeIntegrationInSubFrames, w.nodeIntegrationInWorker],
    [true, true, false, true, false, false]);
  assert.ok(!('preload' in w) && !('session' in w) && !('partition' in w));
});
test('main.js wiring: popup hardened on did-create-window, released on close, no timers, no new IPC/preload', () => {
  const m = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(m, /did-create-window/);
  const fn = m.slice(m.indexOf('function hardenPrintPopup'), m.indexOf('function hardenRemote'));
  assert.match(fn, /isTrustedPrintPopup/); assert.match(fn, /child\.destroy\(\)/);
  assert.match(fn, /once\('closed', \(\) => printPopups\.delete\(child\)\)/);
  assert.match(fn, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(fn, /'will-navigate', \(e\) => e\.preventDefault\(\)/);
  assert.match(fn, /'will-redirect', \(e\) => e\.preventDefault\(\)/);
  assert.match(fn, /removeMenu\(\)/);
  assert.ok(!/setTimeout|setInterval/.test(m), 'no timers that could close the print dialog');
  assert.ok(!/preload/.test(fn) && (m.match(/ipcMain\.on\(/g) || []).length === 4, 'no new IPC');
  assert.ok(!/print\(|close\(\)/.test(fn), 'shell never prints or closes the popup itself');
});

function bootFake() {
  const f = createFakeElectron({ origin: fixture.TRUSTED_ORIGIN, wavPath: fixture.WAV_PATH });
  loadMainWith(f.electron);
  f.fireReady();
  return f;
}
const remoteOf = (f) => f.electron.BaseWindow.getAllWindows()[0].contentView.children.find((v) => !v.webContents.isToolbar).webContents;

test('fake runtime: print popup denied when the opener is not exactly on the trusted site', async () => {
  const f = bootFake(); await new Promise((r) => setTimeout(r, 10));
  const rwc = remoteOf(f);
  for (const u of ['https://u:p@orunvoca.co.kr/', 'chrome-error://chromewebdata/', 'https://www.orunvoca.co.kr/']) {
    rwc.url = u;
    assert.strictEqual(rwc.windowOpen('about:blank'), null, u);
  }
  rwc.url = SITE;
  const w = rwc.windowOpen('about:blank');
  assert.ok(w && !w.destroyed && w.menuRemoved);
  assert.strictEqual(rwc.windowOpen('about:blank'), null, 'limit 1');
  w.close();
  assert.ok(rwc.windowOpen('about:blank'), 'slot released on close');
  assert.deepStrictEqual(f.opened, []);
});
test('fake runtime: a created popup with a non-site origin is destroyed immediately', async () => {
  const f = bootFake(); await new Promise((r) => setTimeout(r, 10));
  const rwc = remoteOf(f);
  rwc.url = SITE;
  const child = new f.electron.BrowserWindow({}, rwc);
  child.webContents.url = 'about:blank'; child.webContents.origin = 'https://evil.example';
  rwc.emit('did-create-window', child, { url: 'about:blank' });
  assert.ok(child.destroyed);
  const child2 = new f.electron.BrowserWindow({}, rwc);
  child2.webContents.url = 'about:blank'; child2.webContents.origin = fixture.TRUSTED_ORIGIN;
  rwc.emit('did-create-window', child2, { url: 'https://orunvoca.co.kr/x' });
  assert.ok(child2.destroyed);
});
test('probe: print popup checks pass and a %PDF is produced', async () => {
  const { r } = await runProbe();
  assert.deepStrictEqual(failing(r), []);
  const names = r.checks.map((c) => c.name).filter((n) => n.startsWith('print popup:'));
  assert.ok(names.length >= 12, names.join('\n'));
  assert.strictEqual(Buffer.from(r.pdfs['print-popup'], 'base64').subarray(0, 5).toString('latin1'), '%PDF-');
});
test('probe: detects the old deny-all behavior (print flow broken)', async () => {
  const { r } = await runProbe({}, {}, (f) => { remoteOf(f).openHandler = () => ({ action: 'deny' }); });
  assert.ok(!r.ok);
  assert.ok(failing(r).some((n) => /opens exactly one popup/.test(n)));
});
test('probe: detects an unhardened popup (nested popups / navigation allowed)', async () => {
  const { r } = await runProbe({}, {}, (f) => {
    remoteOf(f).on('did-create-window', (child) => { child.webContents.openHandler = null; child.webContents.removeAllListeners('will-navigate'); });
  });
  assert.ok(!r.ok);
  const fl = failing(r);
  assert.ok(fl.some((n) => /nested popups/.test(n)) && fl.some((n) => /navigation away/.test(n)), fl.join('\n'));
});
test('probe: detects a popup granted Node integration or a preload', async () => {
  const { r } = await runProbe({}, {}, (f) => {
    remoteOf(f).on('did-create-window', (child) => { child.webContents.prefs.nodeIntegration = true; child.webContents.prefs.preload = 'x.js'; });
  });
  assert.ok(failing(r).some((n) => /nodeIntegration off, no preload/.test(n)));
});
