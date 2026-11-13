'use strict';
// TEST-ONLY CLI: probe the INSTALLED app executable through its main-process Node inspector.
// usage: node smoke/installed-app.js <installed exe> <evidence dir>
// Network is blocked for the whole app process via Chromium switches, so the real site is never
// contacted; the probe then serves the synthetic fixture on the trusted origin inside the session.
// See installed-app-driver.js for the startup/retry policy (one retry, attach failures only).
const fs = require('fs');
const path = require('path');
const fixture = require('./fixture');
const { writeResult } = require('./write-result');
const { runInstalledProbe, NET_BLOCK_ARGS } = require('./installed-app-driver');

(async () => {
  const [exe, outDir] = process.argv.slice(2);
  if (!exe || !outDir) { console.error('usage: installed-app.js <exe> <outDir>'); process.exit(64); }
  fs.mkdirSync(outDir, { recursive: true });
  const { result, attempts } = await runInstalledProbe({
    command: exe,
    logFile: path.join(outDir, 'installed-app-process.log'),
    probeOptions: fixture.probeOptions({ label: 'installed-exe', installIntercept: true, reloadAfterIntercept: true })
  });
  console.log(writeResult(outDir, 'installed-exe', result, {
    executable: exe, networkBlockArgs: NET_BLOCK_ARGS, attempts,
    driver: 'direct Node inspector (--inspect=0) of the installed exe main process; no renderer/CDP attach'
  }));
  process.exit(result.ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
