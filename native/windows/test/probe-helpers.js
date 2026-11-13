'use strict';
const fixture = require('../smoke/fixture');
const { probe } = require('../smoke/probe');
const { createFakeElectron, loadMainWith } = require('./fake-electron');

// Runs the real src/main.js against a fake Electron, with the probe installed exactly like the
// source harness (router first, then app main). Validates probe logic locally; the real Electron
// launch happens on the Windows CI runner.
async function runProbe(fakeOpts = {}, probeExtra = {}, afterMain = null) {
  const f = createFakeElectron({ origin: fixture.TRUSTED_ORIGIN, wavPath: fixture.WAV_PATH, ...fakeOpts });
  globalThis.__orunSmoke = undefined;
  let p;
  f.electron.app.whenReady().then(() => { p = probe(f.electron, fixture.probeOptions({ label: 'mock', timeScale: 0.02, ...probeExtra })); });
  loadMainWith(f.electron);
  f.fireReady();
  await new Promise((r) => setImmediate(r));
  if (afterMain) await afterMain(f); // window exists now; probe is still in its startup waits
  const r = await p;
  return { r, f };
}
const failing = (r) => r.checks.filter((c) => !c.ok).map((c) => c.name);

module.exports = { runProbe, failing };
