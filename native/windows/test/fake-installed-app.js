'use strict';
// Local-test stand-in for the installed exe: `node --inspect=0 test/fake-installed-app.js --user-data-dir=...`.
// Runs the REAL src/main.js on the fake Electron and keeps require('electron') pointed at the fake
// so the driver's inspector evaluation reaches it. FAKE_MODE: ok | fail-first | probe-fail | hang-attach.
const fs = require('node:fs');
const Module = require('node:module');
const { createFakeElectron } = require('./fake-electron');
const fixture = require('../smoke/fixture');

const mode = process.env.FAKE_MODE || 'ok';
if (mode === 'fail-first') {
  const marker = process.env.FAKE_MARKER;
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, 'x'); process.exit(3); }
}
const ud = (process.argv.find((a) => a.startsWith('--user-data-dir=')) || '').slice('--user-data-dir='.length);
const f = createFakeElectron({ origin: fixture.TRUSTED_ORIGIN, wavPath: fixture.WAV_PATH,
  onSetBounds: mode === 'probe-fail' ? (v, b) => { if (v.webContents.doc && b.width === 390) v.webContents.doc = { loadId: 'reloaded' }; } : undefined });
f.electron.app.getPath = () => ud;
f.electron.app.quit = () => setTimeout(() => process.exit(0), 10);
if (mode === 'hang-attach') { const orig = Module._load; Module._load = function (r, ...a) { if (r === 'electron') { for (;;) {} } return orig.call(this, r, ...a); }; }
else { const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? f.electron : orig.call(this, r, ...a); }; }
let ready = false;
f.electron.app.isReady = () => ready;
require('../src/main.js');
f.fireReady();
ready = true;
setInterval(() => {}, 1000); // stay alive like a GUI app
