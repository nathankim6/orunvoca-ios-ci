const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('../smoke/fixture');
const { checkEntries } = require('../smoke/check-asar');
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const srcFiles = fs.readdirSync(path.join(root, 'src'));

test('version is 1.0.1 in package.json and package-lock.json', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.strictEqual(pkg.version, '1.0.1');
  assert.strictEqual(lock.version, '1.0.1');
  assert.strictEqual(lock.packages[''].version, '1.0.1');
});
test('packaging: only src/** and package.json, NSIS x64, publish never, unsigned artifact name', () => {
  assert.deepStrictEqual(pkg.build.files, ['src/**/*', 'package.json']);
  assert.strictEqual(pkg.build.publish, null);
  assert.match(pkg.scripts['package:win'], /--publish never/);
  assert.deepStrictEqual(pkg.build.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.strictEqual(pkg.build.nsis.artifactName, 'OrunVoca-Setup-${version}-x64-unsigned.${ext}');
  assert.ok(!pkg.dependencies, 'no runtime dependencies are packed');
});
test('shipped sources contain no smoke/test hooks or injectable URL', () => {
  for (const f of srcFiles) {
    const s = fs.readFileSync(path.join(root, 'src', f), 'utf8');
    assert.ok(!/smoke|__fixture|protocol\.handle|process\.env|process\.argv|ORUN_|TEST_/i.test(s), f);
  }
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.match(main, /rc\(\)\.loadURL\(sec\.SITE_ORIGIN\)/);
  assert.match(main, new RegExp(`'${fixture.PARTITION}'`));
});
test('production allowlist unchanged: test-ish origins are rejected', () => {
  const S = require('../src/security');
  assert.strictEqual(S.SITE_ORIGIN, 'https://orunvoca.co.kr');
  assert.strictEqual(fixture.TRUSTED_ORIGIN, S.SITE_ORIGIN);
  for (const u of ['http://localhost:3000', 'https://localhost', 'http://127.0.0.1:8080', 'file:///C:/fixture.html', 'app://x'])
    assert.ok(!S.isAllowedNavigation(u), u);
});
test('asar content checker accepts the shell file set and rejects smoke files', () => {
  const ok = ['/package.json', '/src', '/src/layout.js', '/src/main.js', '/src/preload.js', '/src/security.js', '/src/toolbar.html', '/src/toolbar.js'];
  assert.ok(checkEntries(ok).ok);
  assert.ok(!checkEntries([...ok, '/smoke', '/smoke/probe.js']).ok);
  assert.ok(!checkEntries(ok.map((e) => e.replace(/\//g, '\\')).concat(['\\test\\x.js'])).ok);
});
test('synthetic WAV is a valid tiny PCM file', () => {
  const w = fixture.buildWav();
  assert.strictEqual(w.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(w.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(w.readUInt16LE(20), 1); // PCM
  assert.strictEqual(w.readUInt32LE(24), 8000);
  assert.strictEqual(w.readUInt32LE(40), w.length - 44);
  assert.ok(w.length < 4096);
});
test('fixture page is self-contained and labeled synthetic', () => {
  const html = fixture.buildFixtureHtml();
  assert.match(html, /SYNTHETIC LOCAL TEST FIXTURE/);
  assert.ok(!/(src|href)=["']?https?:/i.test(html), 'no remote resources');
  assert.ok(!/orunvoca\.co\.kr\/(api|login|auth)/.test(html));
  assert.deepStrictEqual(Object.keys(fixture.buildRoutes()), ['/', '/fixture/beep.wav']);
});
test('workflow: manual only, read-only token, no release/publish/secrets', () => {
  // Windows checkouts may convert to CRLF (core.autocrlf); normalize before line-anchored matching.
  const wf = fs.readFileSync(path.join(root, '../../.github/workflows/windows-build.yml'), 'utf8').replace(/\r\n?/g, '\n');
  const onBlock = wf.match(/\non:\n([\s\S]*?)\npermissions:/);
  assert.ok(onBlock, 'workflow has an on: block followed by permissions:');
  const on = onBlock[1].trim();
  assert.strictEqual(on, 'workflow_dispatch:');
  assert.match(wf, /permissions:\n {2}contents: read/);
  assert.ok(!/\$\{\{\s*secrets\.|GH_TOKEN|GITHUB_TOKEN|softprops|action-gh-release|gh release|npm publish/i.test(wf));
  assert.ok(!/--publish (always|onTag|onTagOrDraft)/.test(wf));
  assert.match(wf, /--publish never/);
  assert.match(wf, /runs-on: windows-latest/);
  assert.match(wf, /upload-artifact@v4/);
});
