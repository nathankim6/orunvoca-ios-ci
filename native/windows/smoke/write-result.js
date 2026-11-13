'use strict';
// TEST-ONLY: writes probe output as evidence files (JSON + PNG + text summary).
const fs = require('fs');
const path = require('path');

function writeResult(outDir, label, result, extra = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const shotFiles = {};
  for (const [name, b64] of Object.entries(result.shots || {})) {
    const f = `${label}-${name}.png`;
    fs.writeFileSync(path.join(outDir, f), Buffer.from(b64, 'base64'));
    shotFiles[name] = f;
  }
  const json = { label, ok: !!result.ok, generatedAt: new Date().toISOString(), ...extra,
    checks: result.checks || [], info: result.info || {}, screenshots: shotFiles };
  fs.writeFileSync(path.join(outDir, `${label}-result.json`), JSON.stringify(json, null, 2));
  const lines = (result.checks || []).map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  const failed = (result.checks || []).filter((c) => !c.ok).length;
  lines.push('', `${label}: ${result.ok ? 'ALL REQUIRED CHECKS PASSED' : `FAILED (${failed} failing)`}`);
  fs.writeFileSync(path.join(outDir, `${label}-summary.txt`), lines.join('\n') + '\n');
  return lines.join('\n');
}
module.exports = { writeResult };
