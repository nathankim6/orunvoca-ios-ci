'use strict';
// TEST-ONLY Node script: drives the INSTALLED app executable with Playwright's Electron support.
// usage: node smoke/installed-app.js <installed exe> <evidence dir>
// Network is blocked for the whole app process via Chromium switches, so the real site is never
// contacted; the probe then serves the synthetic fixture on the trusted origin inside the session.
const fs = require('fs');
const path = require('path');
const { _electron } = require('playwright-core');
const { probe } = require('./probe');
const fixture = require('./fixture');
const { writeResult } = require('./write-result');

const NET_BLOCK_ARGS = ['--proxy-server=http://127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND'];

(async () => {
  const [exe, outDir] = process.argv.slice(2);
  if (!exe || !outDir) { console.error('usage: installed-app.js <exe> <outDir>'); process.exit(64); }
  fs.mkdirSync(outDir, { recursive: true });
  const log = fs.createWriteStream(path.join(outDir, 'installed-app-process.log'));
  let app; let code = 1;
  try {
    app = await _electron.launch({ executablePath: exe, args: NET_BLOCK_ARGS, timeout: 90000 });
    app.process().stdout.on('data', (d) => log.write(d));
    app.process().stderr.on('data', (d) => log.write(d));
    const result = await app.evaluate(probe, fixture.probeOptions({ label: 'installed-exe', installIntercept: true, reloadAfterIntercept: true }));
    console.log(writeResult(outDir, 'installed-exe', result, { executable: exe, launchArgs: NET_BLOCK_ARGS, driver: 'playwright-core _electron (executablePath)' }));
    code = result.ok ? 0 : 1;
  } catch (e) {
    console.log(writeResult(outDir, 'installed-exe', { ok: false, checks: [{ name: 'installed exe launched and probed via Playwright', ok: false, detail: String(e && e.stack) }] }, { executable: exe }));
    code = 2;
  } finally {
    if (app) await app.close().catch(() => {});
    log.end();
  }
  process.exit(code);
})();
