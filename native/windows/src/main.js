'use strict';
const path = require('path');
const { app, BaseWindow, WebContentsView, Menu, shell, session, ipcMain } = require('electron');
const layout = require('./layout');
const sec = require('./security');

let win, toolbarView, remoteView, mode = layout.MODES.DESKTOP;
const REMOTE_PARTITION = 'persist:orunvoca';

function applyLayout() {
  if (!win || !remoteView) return;
  const [w, h] = win.getContentSize();
  toolbarView.setBounds(layout.computeToolbarBounds(w));
  // Same remote webContents; only its bounds change (real width, no CSS transform).
  remoteView.setBounds(layout.computeRemoteBounds(mode, w, h));
  toolbarView.webContents.send('shell:mode', mode);
}
function setMode(m) { mode = layout.normalizeMode(m); applyLayout(); }
const rc = () => remoteView.webContents;
function goBack() { const h = rc().navigationHistory; if (h.canGoBack()) h.goBack(); }
function printPage() { rc().print({ printBackground: true }); }

// Print popup: no preload, sandboxed, no nested popups, no navigation, no menu; released on close.
// No timers: the user's print dialog is never closed by the shell.
const printPopups = new Set();
function hardenPrintPopup(child, details) {
  const cwc = child.webContents;
  const origin = cwc.mainFrame ? cwc.mainFrame.origin : '';
  if (!sec.isTrustedPrintPopup(details && details.url, origin) || printPopups.size >= sec.PRINT_POPUP_LIMIT) {
    child.destroy();
    return;
  }
  printPopups.add(child);
  child.once('closed', () => printPopups.delete(child));
  child.removeMenu();
  cwc.setWindowOpenHandler(() => ({ action: 'deny' }));
  cwc.on('will-navigate', (e) => e.preventDefault());
  cwc.on('will-redirect', (e) => e.preventDefault());
  cwc.on('will-attach-webview', (e) => e.preventDefault());
}

function hardenRemote(wc, ses) {
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  wc.setWindowOpenHandler((details) => {
    // Only the site's own print popup (about:blank, same origin, one at a time) opens in-app.
    if (sec.isPrintPopupRequest(details, wc.getURL(), printPopups.size)) {
      return { action: 'allow', overrideBrowserWindowOptions: sec.printPopupWindowOptions() };
    }
    if (sec.isSafeExternal(details.url)) shell.openExternal(details.url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child, details) => hardenPrintPopup(child, details));
  const guard = (e, url) => {
    if (sec.isAllowedNavigation(url)) return;
    e.preventDefault();
    if (sec.isSafeExternal(url)) shell.openExternal(url);
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-attach-webview', (e) => e.preventDefault());
  // Downloads: save only to Downloads, never open/execute automatically.
  ses.on('will-download', (_e, item) => {
    item.setSavePath(path.join(app.getPath('downloads'), path.basename(item.getFilename())));
  });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '탐색', submenu: [
      { label: '뒤로', accelerator: 'Alt+Left', click: goBack },
      { label: '새로고침', accelerator: 'CmdOrCtrl+R', click: () => rc().reload() },
      { label: '인쇄...', accelerator: 'CmdOrCtrl+P', click: printPage },
      { type: 'separator' },
      { label: '종료', role: 'quit' } ] },
    { label: '보기', submenu: [
      { label: '데스크톱 모드', accelerator: 'CmdOrCtrl+1', click: () => setMode('desktop') },
      { label: '휴대폰 모드', accelerator: 'CmdOrCtrl+2', click: () => setMode('phone') } ] }
  ]));
}

function createWindow() {
  win = new BaseWindow({ width: 1200, height: 800, minWidth: 420, minHeight: 500, title: '옳은VOCA' });
  toolbarView = new WebContentsView({ webPreferences: {
    ...sec.WEB_PREFERENCES, preload: path.join(__dirname, 'preload.js') } });
  const ses = session.fromPartition(REMOTE_PARTITION);
  // Remote content: no preload, no IPC bridge.
  remoteView = new WebContentsView({ webPreferences: { ...sec.WEB_PREFERENCES, session: ses } });
  win.contentView.addChildView(remoteView);
  win.contentView.addChildView(toolbarView);
  hardenRemote(rc(), ses);
  toolbarView.webContents.on('will-navigate', (e) => e.preventDefault());
  toolbarView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  toolbarView.webContents.loadFile(path.join(__dirname, 'toolbar.html'))
    .then(() => applyLayout());
  // Offline/blocked startup must not raise an unhandled rejection; Chromium shows its error page.
  rc().loadURL(sec.SITE_ORIGIN).catch((err) => console.error('remote load failed:', err && err.code));
  win.on('resize', applyLayout);
  applyLayout();
}

// Toolbar IPC: accept only from the local toolbar webContents.
function fromToolbar(e) { return toolbarView && e.sender === toolbarView.webContents; }
ipcMain.on('shell:set-mode', (e, m) => { if (fromToolbar(e)) setMode(m); });
ipcMain.on('shell:back', (e) => { if (fromToolbar(e)) goBack(); });
ipcMain.on('shell:reload', (e) => { if (fromToolbar(e)) rc().reload(); });
ipcMain.on('shell:print', (e) => { if (fromToolbar(e)) printPage(); });

app.whenReady().then(() => { buildMenu(); createWindow(); });
app.on('window-all-closed', () => app.quit());
