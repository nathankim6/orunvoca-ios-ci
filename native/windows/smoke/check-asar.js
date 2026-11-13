'use strict';
// TEST-ONLY: assert the packaged app.asar contains only the shell sources (no smoke harness/fixture).
// usage: node smoke/check-asar.js <path to app.asar> [<out json>]
const fs = require('fs');
const asar = require('@electron/asar');

const ALLOWED = new Set(['/package.json', '/src', '/src/layout.js', '/src/main.js', '/src/preload.js',
  '/src/security.js', '/src/toolbar.html', '/src/toolbar.js']);

function checkEntries(entries) {
  const norm = entries.map((e) => e.replace(/\\/g, '/'));
  const unexpected = norm.filter((e) => !ALLOWED.has(e));
  const missing = [...ALLOWED].filter((e) => !norm.includes(e));
  return { ok: unexpected.length === 0 && missing.length === 0, entries: norm, unexpected, missing };
}
if (require.main === module) {
  const [file, out] = process.argv.slice(2);
  const r = checkEntries(asar.listPackage(file));
  const main = asar.extractFile(file, 'src/main.js').toString('utf8');
  r.mainHasNoTestHooks = !/smoke|protocol\.handle|process\.env|process\.argv|__fixture/.test(main);
  r.ok = r.ok && r.mainHasNoTestHooks;
  r.file = file;
  const s = JSON.stringify(r, null, 2);
  if (out) fs.writeFileSync(out, s);
  console.log(s);
  process.exit(r.ok ? 0 : 1);
}
module.exports = { ALLOWED, checkEntries };
