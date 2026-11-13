const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/security');
const src = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
test('navigation allows exact site only', () => {
  assert.ok(S.isAllowedNavigation('https://orunvoca.co.kr/a?b=1'));
  for (const u of ['http://orunvoca.co.kr', 'https://www.orunvoca.co.kr', 'https://orunvoca.co.kr.evil.com',
    'https://evil.com', 'file:///C:/x', 'javascript:alert(1)', 'ms-msdt:x', 'not a url'])
    assert.ok(!S.isAllowedNavigation(u), u);
});
test('external only safe https', () => {
  assert.ok(S.isSafeExternal('https://example.com/x'));
  for (const u of ['http://example.com', 'file:///x', 'https://u:p@example.com', 'https://orunvoca.co.kr/'])
    assert.ok(!S.isSafeExternal(u), u);
});
test('web preferences hardened', () => {
  assert.deepStrictEqual([S.WEB_PREFERENCES.contextIsolation, S.WEB_PREFERENCES.sandbox,
    S.WEB_PREFERENCES.nodeIntegration, S.WEB_PREFERENCES.webSecurity], [true, true, false, true]);
});
test('main.js source: no preload on remote, permissions denied, switching keeps one remote view', () => {
  const m = src('main.js');
  assert.match(m, /cb\(false\)/);
  assert.match(m, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(m, /Remote content: no preload/);
  assert.strictEqual((m.match(/new WebContentsView/g) || []).length, 2); // toolbar + one remote
  const setModeFn = m.match(/function setMode[^\n]*/)[0];
  assert.ok(!/loadURL|new WebContentsView/.test(setModeFn));
  assert.ok(!/transform|zoom/i.test(src('layout.js')));
  assert.ok(!/openPath|shell\.openItem/.test(m));
  assert.match(m, /will-attach-webview/);
});
test('preload exposes no fs/generic ipc', () => {
  const p = src('preload.js');
  assert.ok(!/invoke|sendSync|readFile/.test(p));
});
