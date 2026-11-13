const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixture = require('../smoke/fixture');
const { runInstalledProbe } = require('../smoke/installed-app-driver');

// Drives a real `node --inspect=0` child (stand-in for the installed exe) through the same
// inspector driver CI uses against the installed app; the child runs the real src/main.js on a fake Electron.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orun-driver-test-'));
async function run(mode, extra = {}) {
  const env = { FAKE_MODE: mode, FAKE_MARKER: path.join(tmp, `marker-${mode}-${Math.random()}`) };
  Object.assign(process.env, env); // inherited by the spawned child
  try {
    return await runInstalledProbe({ command: process.execPath, leadingArgs: [path.join(__dirname, 'fake-installed-app.js')],
      logFile: path.join(tmp, `${mode}.log`), attachStepTimeoutMs: 3000,
      probeOptions: fixture.probeOptions({ label: 'drv-' + mode, reloadAfterIntercept: true, timeScale: 0.05 }), ...extra });
  } finally { delete process.env.FAKE_MODE; delete process.env.FAKE_MARKER; }
}
const failing = (r) => r.checks.filter((c) => !c.ok).map((c) => c.name);

test('driver: full probe through the main-process inspector, fresh profile, clean exit, single attempt', async () => {
  const { result, attempts } = await run('ok');
  assert.deepStrictEqual(failing(result), []);
  assert.ok(result.ok && result.checks.length >= 40, String(result.checks.length));
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual(attempts[0].phase, 'done');
  assert.ok(attempts[0].freshProfileUsed && attempts[0].exited);
  assert.ok(!fs.existsSync(attempts[0].userDataDir), 'temp profile removed');
  assert.ok(attempts[0].args.includes('--proxy-server=http://127.0.0.1:9'));
});

test('driver: exactly one retry on a launch/attach infrastructure failure, with a new profile', async () => {
  const { result, attempts } = await run('fail-first');
  assert.strictEqual(attempts.length, 2);
  assert.strictEqual(attempts[0].infrastructureFailure, true);
  assert.notStrictEqual(attempts[0].userDataDir, attempts[1].userDataDir);
  assert.ok(attempts[0].exited, 'failed attempt process is gone before retry');
  assert.ok(result.ok, JSON.stringify(failing(result)));
});

test('driver: probe assertion failures are final (no retry, failures reported)', async () => {
  const { result, attempts } = await run('probe-fail');
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual(result.ok, false);
  assert.ok(failing(result).some((n) => /no reload/.test(n)));
});

test('driver: a hung attach is bounded, killed, retried once, then reported as failure', async () => {
  const t0 = Date.now();
  const { result, attempts } = await run('hang-attach');
  assert.strictEqual(attempts.length, 2);
  assert.ok(attempts.every((a) => a.infrastructureFailure && a.exited), JSON.stringify(attempts));
  assert.strictEqual(result.ok, false);
  assert.ok(Date.now() - t0 < 40000);
});
