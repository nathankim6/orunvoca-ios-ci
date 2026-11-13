'use strict';
// TEST-ONLY Electron entry: `electron smoke/harness-main.js [--app-main=<main.js>] [--out=<dir>] [--label=<name>]`.
// Loads the UNMODIFIED shell main (source tree or an installed app.asar) after registering a
// synthetic-fixture router on the production session for the production origin only.
// Never packed: build.files only contains src/** and package.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');
const { probe } = require('./probe');
const fixture = require('./fixture');
const { writeResult } = require('./write-result');

const arg = (name, def) => {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : def;
};
const outDir = path.resolve(arg('out', path.join(os.tmpdir(), 'orunvoca-smoke')));
const appMain = path.resolve(arg('app-main', path.join(__dirname, '..', 'src', 'main.js')));
const label = arg('label', 'source');
const { app } = electron;

// Throwaway profile so the harness never touches a real user profile.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'orunvoca-smoke-profile-')));

const done = (code, result, extra) => {
  try { console.log(writeResult(outDir, label, result, { appMain, ...extra })); } catch (e) { console.error(e); }
  app.exit(code);
};
setTimeout(() => done(3, { ok: false, checks: [{ name: 'harness finished within 120s', ok: false }] }), 120000).unref();

// Registered before the app main is required, so it runs first on ready (router before first load).
app.whenReady().then(() => {
  probe(electron, fixture.probeOptions({ label, installIntercept: true, reloadAfterIntercept: false }))
    .then((r) => done(r.ok ? 0 : 1, r), (e) => done(2, { ok: false, checks: [{ name: 'probe crashed', ok: false, detail: String(e && e.stack) }] }));
});
require(appMain);
