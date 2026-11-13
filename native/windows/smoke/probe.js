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
  const pdfs = {};
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
    ok: checks.length > 0 && checks.every((c) => c.ok), checks, shots, pdfs,
    info: { ...info, requestCounts: { ...store.counts }, blockedNonFixtureRequests: store.blocked.slice(0, 50),
      elapsedMs: Date.now() - started }
  });

  try {
    const TB_STATE = `(() => { const q = (s) => Array.from(document.querySelectorAll(s));
      const vw = document.documentElement.clientWidth;
      const rects = q('button').map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, left: r.left, right: r.right, width: r.width }; });
      return { ids: q('button').map((b) => b.id), on: q('button.on').map((b) => b.id),
        suspicious: q('[id*="sidebar" i],[class*="sidebar" i],[id*="notebook" i],[class*="notebook" i],[id*="note" i],[class*="note" i]').length,
        text: document.body.innerText, viewportWidth: vw, scrollWidth: document.documentElement.scrollWidth,
        outside: rects.filter((r) => !(r.width > 0 && r.left >= 0 && r.right <= vw + 0.5)).map((r) => r.id),
        clipped: q('button').filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.id),
        names: q('button').map((b) => ({ id: b.id, label: (b.getAttribute('aria-label') || b.innerText || '').trim(), title: b.title || '' })) }; })()`;
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
      const limit = { tablet: 768, phone: 390 }[mode];
      if (limit) { const width = Math.min(limit, w); return { x: Math.floor((w - width) / 2), y, width, height }; }
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
    check('desktop content width is wider than the tablet width (tablet differs from desktop)', contentSize().w > 768, contentSize());

    let prevMode = null;
    info.transitions = [];
    const verify = async (step, mode) => {
      if (prevMode && prevMode !== mode) info.transitions.push(prevMode + '>' + mode);
      prevMode = mode;
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
    const viewItems = () => { const m = Menu.getApplicationMenu(); const v = m && m.items.find((i) => i.label === '보기'); return v && v.submenu ? v.submenu.items : []; };
    const modeMenu = viewItems().map((i) => ({ label: i.label, accelerator: i.accelerator }));
    info.modeMenu = modeMenu;
    check('보기 menu is exactly 데스크톱 모드 (Ctrl+1), 태블릿 모드 (Ctrl+2), 휴대폰 모드 (Ctrl+3) in that order',
      JSON.stringify(modeMenu) === JSON.stringify([{ label: '데스크톱 모드', accelerator: 'CmdOrCtrl+1' },
        { label: '태블릿 모드', accelerator: 'CmdOrCtrl+2' }, { label: '휴대폰 모드', accelerator: 'CmdOrCtrl+3' }]), modeMenu);
    const toolbarFits = (step, t) => check(`${step}: toolbar fits (no overflow, no clipped button text, every button visible)`,
      t.scrollWidth <= t.viewportWidth && t.outside.length === 0 && t.clipped.length === 0 && t.ids.length === 6,
      { viewportWidth: t.viewportWidth, scrollWidth: t.scrollWidth, outside: t.outside, clipped: t.clipped, ids: t.ids });

    // Sequence covers all six transitions between 데스크톱/태블릿/휴대폰 via toolbar and menu (Ctrl+1/2/3),
    // tablet 768 vs phone 390, narrow-window clamping and the minimum window width; always the same document.
    await verify('1 initial', 'desktop');
    await sleep(300); await shot('desktop-remote', rwc); await shot('toolbar-desktop', twc); await windowShot('window-desktop');
    toolbarFits('1 initial', await tbState());

    await twc.executeJavaScript(tbClick('tablet'));
    await verify('2 toolbar 태블릿', 'tablet');
    await sleep(300); await shot('tablet-remote', rwc); await shot('toolbar-tablet', twc); await windowShot('window-tablet');

    await twc.executeJavaScript(tbClick('phone'));
    await verify('3 toolbar 휴대폰', 'phone');
    await sleep(300); await shot('phone-remote', rwc); await shot('toolbar-phone', twc); await windowShot('window-phone');

    menuClick('데스크톱 모드');
    await verify('4 menu 데스크톱 모드 (Ctrl+1)', 'desktop');
    menuClick('태블릿 모드');
    await verify('5 menu 태블릿 모드 (Ctrl+2)', 'tablet');
    menuClick('휴대폰 모드');
    await verify('6 menu 휴대폰 모드 (Ctrl+3)', 'phone');

    const before = contentSize();
    win.setContentSize(Math.max(520, before.w - 160), before.h);
    await sleep(300);
    await verify('7 window resized while in phone mode', 'phone');
    win.setContentSize(Math.min(700, before.w), before.h);
    await sleep(300);
    await twc.executeJavaScript(tbClick('tablet'));
    await verify('8 toolbar 태블릿 in a window narrower than 768 (clamps to available width)', 'tablet');
    check('8: narrow tablet fills the available width', contentSize().w < 768 && remote.getBounds().width === contentSize().w, { content: contentSize(), bounds: remote.getBounds() });
    menuClick('데스크톱 모드');
    await verify('9 menu 데스크톱 모드 in a narrow window', 'desktop');
    menuClick('휴대폰 모드');
    await verify('10 menu 휴대폰 모드 in a narrow window', 'phone');

    // Narrowest allowed window (BaseWindow minWidth): toolbar with all six buttons must still fit.
    const [minW] = win.getMinimumSize(); const [, outerH] = win.getSize();
    win.setSize(minW, outerH);
    await sleep(300);
    info.minimumContentSize = contentSize();
    await verify('11 minimum window width in phone mode', 'phone');
    check('11: minimum window content is narrower than tablet but wider than phone', contentSize().w < 768 && contentSize().w >= 390, contentSize());
    const tMin = (await waitFor(async () => { const s = await tbState(); return s.viewportWidth === contentSize().w ? s : null; }, 5000)) || await tbState();
    info.toolbarAtMinimum = tMin;
    toolbarFits('11 minimum width', tMin);
    check('11: every toolbar button keeps an accessible name and tooltip',
      tMin.names.length === 6 && tMin.names.every((n) => n.label && n.title), tMin.names);
    await shot('toolbar-minimum', twc); await windowShot('window-minimum');
    await twc.executeJavaScript(tbClick('tablet'));
    await verify('12 toolbar 태블릿 at minimum width (clamped)', 'tablet');

    win.setContentSize(before.w, before.h);
    await sleep(300);
    await verify('13 window restored while in tablet mode', 'tablet');
    await twc.executeJavaScript(tbClick('desktop'));
    await verify('14 toolbar 데스크톱', 'desktop');
    const needed = ['desktop>tablet', 'tablet>phone', 'phone>desktop', 'desktop>phone', 'phone>tablet', 'tablet>desktop'];
    check('all six desktop/tablet/phone transitions exercised', needed.every((x) => info.transitions.includes(x)), info.transitions);

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
    check('toolbar has exactly back, reload, desktop, tablet, phone, print buttons and no sidebar/notebook elements',
      JSON.stringify(tf.ids) === JSON.stringify(['back', 'reload', 'desktop', 'tablet', 'phone', 'print']) && tf.suspicious === 0 &&
      !/노트|단어장|사이드/.test(tf.text), tf);

    // Remote content isolation and navigation guard (no external browser launch: http targets only).
    const sSec = await pageState();
    check('remote page has no preload bridge / Node globals', sSec.bridge === 'undefined' && sSec.nodeRequire === 'undefined' && sSec.nodeProcess === 'undefined', sSec);
    await rwc.executeJavaScript("window.__fixture.tryNavigate('http://example.invalid/')");
    await sleep(1500);
    const sNav = await pageState();
    check('navigation to a non-allowlisted origin is blocked in-app', rwc.getURL().startsWith(origin + '/') && sNav.loadId === base.loadId, { url: rwc.getURL() });
    // Unrelated popups stay denied: off-site, same-site page URL, about:blank variant. (http targets only:
    // no external browser launch on the runner.)
    const unrelated = {};
    for (const u of ['http://example.invalid/', origin + '/other-page', 'about:blank#x']) {
      unrelated[u] = await rwc.executeJavaScript(`window.__fixture.tryPopup(${JSON.stringify(u)})`, true);
    }
    await sleep(500);
    check('unrelated window.open requests are denied and create no window',
      Object.values(unrelated).every((v) => v === 'null') && BaseWindow.getAllWindows().length === 1, { unrelated, windows: BaseWindow.getAllWindows().length });
    const perm = await rwc.executeJavaScript('window.__fixture.notificationPermission()', true);
    check('permission requests are denied (notifications)', perm === 'denied', { perm });

    // Synthetic pronunciation audio from the trusted-origin fixture.
    const audio = await rwc.executeJavaScript('window.__fixture.playPronunciation()', true);
    info.audio = audio;
    check('synthetic pronunciation clip fetched from fixture and decoded', audio.fetched && audio.decoded && (store.counts[opts.wavPath] || 0) >= 1, audio);
    info.audioPlaybackInformational = audio.play; // hosted VM may lack an audio endpoint: informational only
    await sleep(300); await shot('desktop-after-audio', rwc);

    // Site test-paper print flow: window.open('', '_blank') + document.write + print()/close().
    // print() itself opens the OS print dialog, so the popup is rendered with printToPDF instead.
    const winCount = () => BaseWindow.getAllWindows().length;
    const others = () => BaseWindow.getAllWindows().filter((w) => w !== win);
    const pop1 = await rwc.executeJavaScript('window.__fixture.openPrintPopup()', true);
    const child = await waitFor(() => others()[0], 5000);
    info.printPopup = { opener: pop1 };
    check('print popup: window.open("", "_blank") from the trusted page opens exactly one popup window',
      pop1.opened === true && !!child && winCount() === 2, { pop1, windows: winCount() });
    if (child) {
      const cwc = child.webContents;
      const prefs = (cwc.getLastWebPreferences && cwc.getLastWebPreferences()) || {};
      const cOrigin = cwc.mainFrame ? cwc.mainFrame.origin : undefined;
      info.printPopup.child = { url: cwc.getURL(), origin: cOrigin, title: child.getTitle(),
        prefs: { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration,
          nodeIntegrationInSubFrames: prefs.nodeIntegrationInSubFrames, webSecurity: prefs.webSecurity, preload: prefs.preload || null } };
      check('print popup: about:blank document with the inherited trusted origin',
        /^(about:blank)?$/.test(cwc.getURL()) && cOrigin === origin && pop1.childOrigin === origin, info.printPopup.child);
      check('print popup: opener has same-origin DOM access to the document.write test paper', pop1.sameOriginAccess === true, pop1);
      check('print popup: sandbox + contextIsolation on, nodeIntegration off, no preload',
        prefs.sandbox === true && prefs.contextIsolation === true && prefs.nodeIntegration === false &&
        prefs.nodeIntegrationInSubFrames !== true && !prefs.preload && prefs.webSecurity !== false, info.printPopup.child.prefs);
      check('print popup: no Node or shell bridge globals in the popup',
        pop1.childHasRequire === 'undefined' && pop1.childHasProcess === 'undefined' && pop1.childHasBridge === 'undefined', pop1);
      check('print popup: uses the trusted session (same deny-all permission policy)', cwc.session === ses0);
      const nested = await rwc.executeJavaScript('window.__fixture.printPopupNested()', true);
      await sleep(300);
      check('print popup: nested popups from the popup are denied', nested.blank === 'null' && nested.external === 'null' && winCount() === 2, nested);
      await rwc.executeJavaScript("window.__fixture.printPopupNavigate('http://example.invalid/')");
      await sleep(1500);
      const still = await rwc.executeJavaScript('window.__fixture.printPopupState()');
      check('print popup: popup and opener-initiated navigation away from the test paper is blocked',
        !cwc.isDestroyed() && still.sameOriginAccess === true && /^(about:blank)?$/.test(cwc.getURL()), { url: cwc.getURL(), still });
      const second = await rwc.executeJavaScript('window.__fixture.openSecondPrintPopup()', true);
      await sleep(300);
      check('print popup: a second concurrent popup is denied (limit 1)', second === 'null' && winCount() === 2, { second, windows: winCount() });
      try {
        const pdf = await cwc.printToPDF({ printBackground: true });
        pdfs['print-popup'] = Buffer.from(pdf).toString('base64');
        info.printPopup.pdfBytes = pdf.length;
        check('print popup: Electron printToPDF of the popup yields a non-empty %PDF document (not a physical-printer test)',
          pdf.length > 500 && Buffer.from(pdf).subarray(0, 5).toString('latin1') === '%PDF-', { bytes: pdf.length });
      } catch (e) { check('print popup: Electron printToPDF of the popup', false, String(e)); }
      await shot('print-popup', cwc);
      await rwc.executeJavaScript('window.__fixture.closePrintPopup()');
      check('print popup: close() from the opener closes it and releases the slot', await waitFor(() => winCount() === 1, 5000), { windows: winCount() });
      const again = await rwc.executeJavaScript('window.__fixture.openPrintPopup()', true);
      const child2 = await waitFor(() => others()[0], 5000);
      check('print popup: a new print popup is allowed again after the previous one closed', again.opened === true && !!child2 && again.sameOriginAccess === true, again);
      await rwc.executeJavaScript('window.__fixture.closePrintPopup()');
      check('print popup: reopened popup closed, only the main window remains', await waitFor(() => winCount() === 1, 5000), { windows: winCount() });
    }

    const sEnd = await pageState();
    check('end: same document and webContents after all checks', sEnd.loadId === base.loadId && rwc.id === base.wcId && (store.counts['/'] || 0) === base.docCount);
    info.userData = electron.app.getPath('userData');
  } catch (e) {
    check('probe completed without exception', false, String((e && e.stack) || e));
  }
  return finish();
}

module.exports = { probe };
