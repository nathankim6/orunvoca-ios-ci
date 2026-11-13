'use strict';
// TEST-ONLY runtime probe. Not packed (outside build.files).
// `probe` MUST stay self-contained (no closure references): installed-app-driver.js serializes it with
// fn.toString() to run inside the main process of the INSTALLED app, and the source harness
// calls it directly. It only inspects the real shell; it adds no hooks to the shipped app.
async function probe(electron, opts) {
  const { BaseWindow, Menu, session } = electron;
  const scale = opts.timeScale || 1; // <1 only in local mock tests
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * scale));
  const started = Date.now();
  const checks = [];
  const shots = {};
  const info = { label: opts.label, platform: process.platform, arch: process.arch,
    electron: process.versions.electron, chrome: process.versions.chrome, steps: [] };
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); return !!ok; };
  const waitFor = async (fn, timeoutMs = 20000, stepMs = 100) => {
    const t0 = Date.now(); let v;
    while (Date.now() - t0 < timeoutMs * scale) {
      try { v = await fn(); if (v) return v; } catch (e) { v = undefined; }
      await new Promise((r) => setTimeout(r, Math.min(stepMs, 20 + stepMs * scale)));
    }
    return v;
  };
  const origin = opts.trustedOrigin;
  const store = globalThis.__orunSmoke || (globalThis.__orunSmoke = { counts: {}, blocked: [], installed: false });
  const ses0 = session.fromPartition(opts.partition);

  // Synthetic fixture router: test process only, production origin only, everything else 403.
  // Installed synchronously (before the first await) so the source harness intercepts the first load.
  if (opts.installIntercept && !store.installed) {
    ses0.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      if (u.origin !== origin) {
        store.blocked.push(req.url);
        return new Response('blocked by smoke harness', { status: 403 });
      }
      store.counts[u.pathname] = (store.counts[u.pathname] || 0) + 1;
      const r = opts.routes[u.pathname];
      if (!r) return new Response('not found', { status: 404 });
      return new Response(Buffer.from(r.body, 'base64'),
        { status: 200, headers: { 'content-type': r.type, 'cache-control': 'no-store' } });
    });
    store.installed = true;
  }

  const finish = () => ({
    ok: checks.length > 0 && checks.every((c) => c.ok), checks, shots,
    info: { ...info, requestCounts: { ...store.counts }, blockedNonFixtureRequests: store.blocked.slice(0, 50),
      elapsedMs: Date.now() - started }
  });

  try {
    const TB_STATE = `(() => { const q = (s) => Array.from(document.querySelectorAll(s));
      return { ids: q('button').map((b) => b.id), on: q('button.on').map((b) => b.id),
        suspicious: q('[id*="sidebar" i],[class*="sidebar" i],[id*="notebook" i],[class*="notebook" i],[id*="note" i],[class*="note" i]').length,
        text: document.body.innerText }; })()`;
    const tbClick = (id) => `document.getElementById(${JSON.stringify(id)}).click(); true`;

    const win = await waitFor(() => BaseWindow.getAllWindows()[0], 30000);
    if (!check('application window created', win)) return finish();
    await waitFor(() => win.contentView.children.length >= 2, 10000);
    const kids = () => win.contentView.children;
    const urlOf = (v) => { try { return v.webContents.getURL(); } catch (e) { return ''; } };
    const tb = await waitFor(() => kids().find((v) => /toolbar\.html$/.test(urlOf(v))), 15000);
    check('local toolbar view loaded from file://.../toolbar.html', tb, { views: kids().map(urlOf) });
    const remote = kids().find((v) => v !== tb);
    check('exactly 1 window with exactly 2 child views (toolbar + one remote view; no sidebar/notebook view)',
      BaseWindow.getAllWindows().length === 1 && kids().length === 2 && remote,
      { windows: BaseWindow.getAllWindows().length, views: kids().map(urlOf) });
    if (!tb || !remote) return finish();
    const rwc = remote.webContents;
    const twc = tb.webContents;
    check('window title is 옳은VOCA', win.getTitle() === '옳은VOCA', { title: win.getTitle() });
    check('remote view uses the persist:orunvoca session', rwc.session === ses0);
    await waitFor(() => !twc.isLoading(), 10000);

    if (opts.reloadAfterIntercept) {
      // Installed app: its first real-site load was network-blocked by launch switches; wait for it to settle,
      // then load the synthetic fixture on the same trusted origin through the router.
      await waitFor(() => !rwc.isLoading(), 20000);
      info.initialUrlBeforeFixture = rwc.getURL();
      await rwc.loadURL(origin + '/').catch((e) => { info.fixtureLoadError = String(e); });
    }
    const ready = await waitFor(async () => !rwc.isLoading() && rwc.getURL().startsWith(origin + '/') &&
      await rwc.executeJavaScript('!!(window.__fixture && window.__fixture.ready)'), 20000);
    check('remote view shows the synthetic fixture on the trusted origin', ready, { url: rwc.getURL() });
    if (!ready) return finish();

    const pageState = () => rwc.executeJavaScript('window.__fixture.state()');
    const tbState = () => twc.executeJavaScript(TB_STATE);
    const contentSize = () => { const [w, h] = win.getContentSize(); return { w, h }; };
    const expected = (mode) => { // independent oracle (does not reuse src/layout.js)
      const { w, h } = contentSize(); const y = 40; const height = Math.max(0, h - y);
      if (mode === 'phone') { const width = Math.min(390, w); return { x: Math.floor((w - width) / 2), y, width, height }; }
      return { x: 0, y, width: w, height };
    };
    const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    const shot = async (name, wc) => {
      try { const img = await wc.capturePage(); shots[name] = img.toPNG().toString('base64'); }
      catch (e) { info['shotError_' + name] = String(e); }
    };
    const windowShot = async (name) => { // best effort, includes the native frame
      try {
        const srcs = await electron.desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1000 } });
        const s = srcs.find((x) => x.name === win.getTitle());
        if (s && !s.thumbnail.isEmpty()) shots[name] = s.thumbnail.toPNG().toString('base64');
        else info['windowShotMissing_' + name] = srcs.map((x) => x.name);
      } catch (e) { info['windowShotError_' + name] = String(e); }
    };

    const s0 = await pageState();
    const base = { wcId: rwc.id, pid: rwc.getOSProcessId(), loadId: s0.loadId, docCount: store.counts['/'] || 0 };
    info.base = base;
    info.initialContentSize = contentSize();
    check('desktop content width is wider than the phone width (toggle is meaningful)', contentSize().w > 400, contentSize());

    const verify = async (step, mode) => {
      const exp = expected(mode);
      const bOk = await waitFor(() => sameRect(remote.getBounds(), expected(mode)), 5000);
      const st = (await waitFor(async () => { const s = await pageState(); return Math.abs(s.innerWidth - expected(mode).width) <= 1 ? s : null; }, 5000)) || await pageState();
      const t = (await waitFor(async () => { const s = await tbState(); return s.on.length === 1 && s.on[0] === mode ? s : null; }, 5000)) || await tbState();
      const actual = remote.getBounds();
      info.steps.push({ step, mode, expected: exp, actual, content: contentSize(), innerWidth: st.innerWidth, phoneMQ: st.phoneMQ, toolbarOn: t.on });
      check(`${step}: remote view bounds are the real ${mode} viewport`, bOk, { expected: exp, actual, content: contentSize() });
      check(`${step}: page window.innerWidth equals view width (real viewport, no CSS transform)`,
        Math.abs(st.innerWidth - exp.width) <= 1 && st.transform === 'none', { innerWidth: st.innerWidth, expected: exp.width, dpr: st.dpr, transform: st.transform });
      check(`${step}: phone-width media query ${mode === 'phone' ? 'matches' : 'does not match'}`, st.phoneMQ === (mode === 'phone' || exp.width <= 400));
      check(`${step}: same remote webContents id ${base.wcId}, same renderer pid, still exactly 2 views`,
        !rwc.isDestroyed() && rwc.id === base.wcId && rwc.getOSProcessId() === base.pid && kids().length === 2 && kids().includes(remote),
        { id: rwc.id, pid: rwc.getOSProcessId(), views: kids().length });
      check(`${step}: no reload/re-navigation (same document loadId, fixture document requested ${base.docCount}x)`,
        st.loadId === base.loadId && (store.counts['/'] || 0) === base.docCount, { loadId: st.loadId, docRequests: store.counts['/'] });
      check(`${step}: same session object`, rwc.session === ses0);
      check(`${step}: toolbar highlights ${mode}`, t.on.length === 1 && t.on[0] === mode, { on: t.on });
    };
    const menuItem = (label) => {
      const m = Menu.getApplicationMenu();
      for (const top of (m ? m.items : [])) for (const it of (top.submenu ? top.submenu.items : [])) if (it.label === label) return it;
      return null;
    };
    const menuClick = (label) => { const it = menuItem(label); if (!it) throw new Error('menu item missing: ' + label); it.click(); };

    await verify('1 initial', 'desktop');
    await sleep(300); await shot('desktop-remote', rwc); await shot('toolbar-desktop', twc); await windowShot('window-desktop');

    await twc.executeJavaScript(tbClick('phone'));
    await verify('2 toolbar 휴대폰', 'phone');
    await sleep(300); await shot('phone-remote', rwc); await shot('toolbar-phone', twc); await windowShot('window-phone');

    menuClick('데스크톱 모드');
    await verify('3 menu 데스크톱 모드 (Ctrl+1)', 'desktop');
    menuClick('휴대폰 모드');
    await verify('4 menu 휴대폰 모드 (Ctrl+2)', 'phone');

    const before = contentSize();
    win.setContentSize(Math.max(520, before.w - 160), before.h);
    await sleep(300);
    await verify('5 window resized while in phone mode', 'phone');
    win.setContentSize(before.w, before.h);
    await sleep(300);
    await twc.executeJavaScript(tbClick('desktop'));
    await verify('6 toolbar 데스크톱', 'desktop');

    // No sidebar / notebook anywhere in the shell UI.
    const labels = [];
    const walk = (items) => { for (const it of items) { if (it.label) labels.push(it.label); if (it.submenu) walk(it.submenu.items); } };
    const appMenu = Menu.getApplicationMenu();
    walk(appMenu ? appMenu.items : []);
    info.menuLabels = labels;
    check('application menu top level is exactly 탐색, 보기', JSON.stringify((appMenu ? appMenu.items : []).map((i) => i.label)) === JSON.stringify(['탐색', '보기']));
    check('no notebook/sidebar menu entries', !labels.some((l) => /노트|단어장|사이드|sidebar|notebook|note/i.test(l)), labels);
    const tf = await tbState();
    info.toolbar = tf;
    check('toolbar has exactly back, reload, desktop, phone, print buttons and no sidebar/notebook elements',
      JSON.stringify(tf.ids) === JSON.stringify(['back', 'reload', 'desktop', 'phone', 'print']) && tf.suspicious === 0 &&
      !/노트|단어장|사이드/.test(tf.text), tf);

    // Remote content isolation and navigation guard (no external browser launch: http targets only).
    const sSec = await pageState();
    check('remote page has no preload bridge / Node globals', sSec.bridge === 'undefined' && sSec.nodeRequire === 'undefined' && sSec.nodeProcess === 'undefined', sSec);
    await rwc.executeJavaScript("window.__fixture.tryNavigate('http://example.invalid/')");
    await sleep(1500);
    const sNav = await pageState();
    check('navigation to a non-allowlisted origin is blocked in-app', rwc.getURL().startsWith(origin + '/') && sNav.loadId === base.loadId, { url: rwc.getURL() });
    const pop = await rwc.executeJavaScript("window.__fixture.tryPopup('http://example.invalid/')", true);
    await sleep(500);
    check('window.open is denied and creates no window', pop === 'null' && BaseWindow.getAllWindows().length === 1, { pop, windows: BaseWindow.getAllWindows().length });
    const perm = await rwc.executeJavaScript('window.__fixture.notificationPermission()', true);
    check('permission requests are denied (notifications)', perm === 'denied', { perm });

    // Synthetic pronunciation audio from the trusted-origin fixture.
    const audio = await rwc.executeJavaScript('window.__fixture.playPronunciation()', true);
    info.audio = audio;
    check('synthetic pronunciation clip fetched from fixture and decoded', audio.fetched && audio.decoded && (store.counts[opts.wavPath] || 0) >= 1, audio);
    info.audioPlaybackInformational = audio.play; // hosted VM may lack an audio endpoint: informational only
    await sleep(300); await shot('desktop-after-audio', rwc);

    const sEnd = await pageState();
    check('end: same document and webContents after all checks', sEnd.loadId === base.loadId && rwc.id === base.wcId && (store.counts['/'] || 0) === base.docCount);
    info.userData = electron.app.getPath('userData');
  } catch (e) {
    check('probe completed without exception', false, String((e && e.stack) || e));
  }
  return finish();
}

module.exports = { probe };
