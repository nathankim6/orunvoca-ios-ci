'use strict';
// TEST-ONLY driver for the INSTALLED app executable. Not packed (outside build.files).
//
// Why not Playwright: run 43367470552 showed playwright _electron.launch() hanging for 90s AFTER
// both the Node inspector and Chromium CDP websockets connected (its CDP page/target attach step),
// while the app itself was running. The probe only needs the main-process Node inspector, so this
// driver talks to that inspector directly and never attaches to renderer targets.
//
// Startup hardening (harness only, the shipped app is untouched):
//  - fresh --user-data-dir per attempt (no reuse of the profile left by the force-killed plain launch)
//  - the whole process tree of a failed attempt is killed before any retry
//  - exactly ONE retry, and only for launch/attach infrastructure failures (spawn, inspector URL,
//    websocket, Runtime.enable, require('electron') sanity). Once the probe has started, any
//    failure or timeout is final: probe assertions are never retried or skipped.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { probe } = require('./probe');

const NET_BLOCK_ARGS = ['--proxy-server=http://127.0.0.1:9', '--host-resolver-rules=MAP * ~NOTFOUND'];

class AttachError extends Error {}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch (e) { /* already gone */ }
}
function waitExit(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((r) => { const t = setTimeout(() => r(false), ms); child.once('exit', () => { clearTimeout(t); r(true); }); });
}

function waitForInspectorUrl(child, ms, onLine) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new AttachError(`no "Debugger listening" line within ${ms}ms`)), ms);
    const onData = (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (onLine) onLine(line);
        const m = line.match(/Debugger listening on (ws:\/\/\S+)/);
        if (m) { clearTimeout(t); child.stderr.off('data', onData); resolve(m[1]); }
      }
    };
    child.stderr.on('data', onData);
    child.once('exit', (c, s) => { clearTimeout(t); reject(new AttachError(`process exited before inspector was ready (code ${c}, signal ${s})`)); });
    child.once('error', (e) => { clearTimeout(t); reject(new AttachError('spawn failed: ' + e.message)); });
  });
}

class Inspector {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map(); }
  open(ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new AttachError('inspector websocket open timeout')), ms);
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => { clearTimeout(t); resolve(); };
      this.ws.onerror = (e) => { clearTimeout(t); reject(new AttachError('inspector websocket error: ' + (e.message || e.type))); };
      this.ws.onclose = () => { for (const p of this.pending.values()) p.reject(new Error('inspector websocket closed')); this.pending.clear(); };
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
        const p = msg.id && this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`)); else p.resolve(msg.result);
      };
    });
  }
  send(method, params, ms) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after ${ms}ms`)); }, ms);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  evaluate(expression, ms) {
    // includeCommandLineAPI exposes require() in the Electron main-process context.
    return this.send('Runtime.evaluate', { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true }, ms);
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function attempt(n, cfg, log) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `orunvoca-installed-profile-${n}-`));
  const args = ['--inspect=0', ...(cfg.leadingArgs || []), `--user-data-dir=${userDataDir}`, ...NET_BLOCK_ARGS];
  const rec = { attempt: n, userDataDir, args, phase: 'launch', startedAt: new Date().toISOString() };
  log.write(`--- attempt ${n}: ${cfg.command} ${args.join(' ')}\n`);
  const child = spawn(cfg.command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  rec.pid = child.pid;
  child.stdout.on('data', (d) => log.write(d));
  child.stderr.on('data', (d) => log.write(d));
  let ins;
  try {
    const url = await waitForInspectorUrl(child, cfg.attachTimeoutMs);
    rec.phase = 'attach';
    ins = new Inspector(url);
    await ins.open(cfg.attachStepTimeoutMs);
    try {
      await ins.send('Runtime.enable', {}, cfg.attachStepTimeoutMs);
      // The inspector is up before the app's main module has finished starting: poll (bounded) until the
      // Electron module is reachable and the app is ready, instead of racing a single early evaluation.
      const deadline = Date.now() + cfg.attachStepTimeoutMs;
      const READY = "JSON.stringify({ e: process.versions.electron, t: typeof require('electron').BaseWindow, r: require('electron').app.isReady() })";
      let last = 'not evaluated';
      for (;;) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('app not ready for inspection: ' + last);
        try {
          const res = await ins.evaluate(READY, left);
          if (res.exceptionDetails) last = 'exception: ' + JSON.stringify(res.exceptionDetails).slice(0, 300);
          else { rec.sanity = JSON.parse(res.result.value); last = res.result.value; if (rec.sanity.t === 'function' && rec.sanity.r === true) break; }
        } catch (e) { last = e.message; }
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) { throw new AttachError(e.message); }

    rec.phase = 'probe'; // from here on, nothing is retried
    const opts = cfg.probeOptions;
    const expr = `(async () => { const electron = require('electron'); const probe = ${probe.toString()};
      return JSON.stringify(await probe(electron, ${JSON.stringify(opts)})); })()`;
    const res = await ins.evaluate(expr, cfg.probeTimeoutMs);
    if (res.exceptionDetails) throw new Error('probe threw: ' + JSON.stringify(res.exceptionDetails).slice(0, 2000));
    const result = JSON.parse(res.result.value);
    rec.phase = 'done';
    // Graceful quit, then make sure the tree is gone.
    await ins.evaluate("require('electron').app.quit(); true", 5000).catch(() => {});
    ins.close();
    rec.exitedGracefully = await waitExit(child, 15000);
    rec.appUserData = result.info && result.info.userData;
    rec.freshProfileUsed = !!rec.appUserData && path.resolve(rec.appUserData).toLowerCase() === path.resolve(userDataDir).toLowerCase();
    return { result, rec };
  } catch (e) {
    e.rec = rec;
    throw e;
  } finally {
    if (ins) ins.close();
    killTree(child);
    rec.exited = await waitExit(child, 15000);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { rec.profileCleanup = String(e); }
  }
}

// cfg: { command, leadingArgs?, probeOptions, attachTimeoutMs?, attachStepTimeoutMs?, probeTimeoutMs?, logFile, maxAttempts? }
async function runInstalledProbe(cfg) {
  cfg = { attachTimeoutMs: 60000, attachStepTimeoutMs: 15000, probeTimeoutMs: 180000, maxAttempts: 2, ...cfg };
  const log = fs.createWriteStream(cfg.logFile, { flags: 'a' });
  const attempts = [];
  try {
    for (let n = 1; n <= cfg.maxAttempts; n++) {
      try {
        const { result, rec } = await attempt(n, cfg, log);
        attempts.push(rec);
        return { result, attempts };
      } catch (e) {
        const infra = e instanceof AttachError;
        attempts.push({ ...(e && e.rec), failedPhase: infra ? 'launch/attach' : 'probe', infrastructureFailure: infra, error: String(e && e.message) });
        log.write(`--- attempt ${n} failed (${infra ? 'launch/attach infrastructure' : 'probe'}): ${e && e.message}\n`);
        if (!infra || n === cfg.maxAttempts) {
          return { result: { ok: false, checks: [{ name: 'installed exe launched, inspector attached and probe completed', ok: false, detail: String((e && e.stack) || e) }] }, attempts };
        }
      }
    }
  } finally {
    await new Promise((r) => log.end(r));
  }
  return { result: { ok: false, checks: [{ name: 'installed exe probe', ok: false }] }, attempts };
}

module.exports = { runInstalledProbe, NET_BLOCK_ARGS, AttachError };
