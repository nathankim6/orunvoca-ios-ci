'use strict';
// Minimal in-memory Electron stand-in used ONLY by local Node tests to exercise the real
// src/main.js control flow (toolbar IPC, menu, layout, guards) together with smoke/probe.js.
// It is not a substitute for the real Electron launch, which runs on the Windows CI runner.
const Module = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');

function createFakeElectron({ origin, wavPath, onSetBounds } = {}) {
  let resolveReady;
  const readyPromise = new Promise((r) => { resolveReady = r; });
  const sessions = new Map();
  const windows = [];
  const opened = [];
  let appMenu = null;
  let seq = 0;

  class FakeSession {
    constructor(name) { this.name = name; this.handlers = {}; this.protocol = { handle: (s, fn) => { this.handlers[s] = fn; } }; }
    setPermissionRequestHandler(fn) { this.permReq = fn; }
    setPermissionCheckHandler(fn) { this.permCheck = fn; }
    on() {}
  }
  const session = {
    fromPartition: (p) => { if (!sessions.has(p)) sessions.set(p, new FakeSession(p)); return sessions.get(p); },
    get defaultSession() { return session.fromPartition('__default__'); }
  };
  const ipcMain = new EventEmitter();

  class FakeWC extends EventEmitter {
    constructor(ses, view) {
      super(); this.id = ++seq; this.session = ses; this.view = view; this.url = ''; this.doc = null; this.pid = 1000 + seq;
      this.navigationHistory = { canGoBack: () => false, goBack() {} };
    }
    loadFile(p) { this.url = 'file:///' + p.replace(/\\/g, '/').replace(/^\//, ''); this.isToolbar = /toolbar\.html$/.test(p); return Promise.resolve(); }
    async loadURL(u) {
      const h = this.session.handlers.https;
      if (!h) { this.url = 'chrome-error://chromewebdata/'; this.doc = null; throw Object.assign(new Error('ERR_NAME_NOT_RESOLVED'), { code: 'ERR_NAME_NOT_RESOLVED' }); }
      const res = await h(new Request(u));
      this.url = new URL(u).href;
      this.doc = res.ok ? { loadId: 'L' + Math.random().toString(36).slice(2) } : null;
    }
    reload() { return this.loadURL(this.url); }
    getURL() { return this.url; }
    isLoading() { return false; }
    isDestroyed() { return false; }
    getOSProcessId() { return this.pid; }
    setWindowOpenHandler(fn) { this.openHandler = fn; }
    send(ch, m) { if (ch === 'shell:mode') this.toolbarMode = m; }
    print() {}
    async capturePage() { return { toPNG: () => Buffer.from('fakepng'), getSize: () => ({ ...this.view.bounds }) }; }
    async executeJavaScript(code) { return this.isToolbar ? this.toolbarExec(code) : this.remoteExec(code); }
    toolbarExec(code) {
      if (code.includes('querySelectorAll')) {
        return { ids: ['back', 'reload', 'desktop', 'phone', 'print'], on: this.toolbarMode ? [this.toolbarMode] : [], suspicious: 0, text: '뒤로 새로고침 데스크톱 휴대폰 인쇄' };
      }
      const m = code.match(/getElementById\("(\w+)"\)\.click\(\)/);
      if (m) {
        const e = { sender: this };
        if (m[1] === 'phone' || m[1] === 'desktop') ipcMain.emit('shell:set-mode', e, m[1]);
        else ipcMain.emit('shell:' + m[1], e);
        return true;
      }
      throw new Error('unexpected toolbar code ' + code);
    }
    async remoteExec(code) {
      if (code.includes('window.__fixture.ready')) return !!this.doc;
      if (!this.doc) throw new Error('no fixture document');
      if (code === 'window.__fixture.state()') {
        const w = this.view.bounds.width;
        return { ready: true, loadId: this.doc.loadId, innerWidth: w, innerHeight: this.view.bounds.height, dpr: 1, phoneMQ: w <= 400,
          url: this.url, navType: 'navigate', transform: 'none', bridge: 'undefined', nodeRequire: 'undefined', nodeProcess: 'undefined' };
      }
      let m = code.match(/tryNavigate\('([^']+)'\)/);
      if (m) {
        const ev = { prevented: false, preventDefault() { this.prevented = true; } };
        this.emit('will-navigate', ev, m[1]);
        if (!ev.prevented) { this.url = m[1]; this.doc = { loadId: 'NAV' }; }
        return true;
      }
      m = code.match(/tryPopup\('([^']+)'\)/);
      if (m) return this.openHandler({ url: m[1] }).action === 'deny' ? 'null' : '[object Window]';
      if (code.includes('notificationPermission')) {
        return new Promise((r) => this.session.permReq(this, 'notifications', (ok) => r(ok ? 'granted' : 'denied')));
      }
      if (code.includes('playPronunciation')) {
        const res = await this.session.handlers.https(new Request(origin + wavPath));
        const buf = Buffer.from(await res.arrayBuffer());
        const ok = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
        return { fetched: res.ok, decoded: ok, bytes: buf.length, play: 'fake', speechSynthesis: 'object' };
      }
      throw new Error('unexpected remote code ' + code);
    }
  }
  class WebContentsView {
    constructor({ webPreferences }) {
      this.webPreferences = webPreferences; this.bounds = { x: 0, y: 0, width: 0, height: 0 };
      this.webContents = new FakeWC(webPreferences.session || session.defaultSession, this);
    }
    setBounds(b) { this.bounds = { ...b }; if (onSetBounds) onSetBounds(this, b); }
    getBounds() { return { ...this.bounds }; }
  }
  class BaseWindow extends EventEmitter {
    constructor(o) { super(); this.o = o; this.size = [o.width - 16, o.height - 39]; this.contentView = { children: [], addChildView: (v) => this.contentView.children.push(v) }; windows.push(this); }
    static getAllWindows() { return windows.slice(); }
    getContentSize() { return this.size.slice(); }
    setContentSize(w, h) { this.size = [w, h]; this.emit('resize'); }
    getTitle() { return this.o.title; }
  }
  const toItems = (t) => ({ items: t.map((i) => ({ ...i, click: i.click || (() => {}), submenu: i.submenu ? toItems(i.submenu) : undefined })) });
  const Menu = { buildFromTemplate: toItems, setApplicationMenu: (m) => { appMenu = m; }, getApplicationMenu: () => appMenu };
  const app = { whenReady: () => readyPromise, on() {}, quit() {}, exit() {}, getPath: () => path.join(require('node:os').tmpdir(), 'fake-userdata') };
  const electron = { app, BaseWindow, WebContentsView, Menu, session, ipcMain, shell: { openExternal: (u) => opened.push(u) } };
  return { electron, fireReady: () => resolveReady(), opened };
}

// Load the real src/main.js with `require('electron')` answered by the fake.
function loadMainWith(electron) {
  const mainPath = require.resolve('../src/main.js');
  delete require.cache[mainPath];
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? electron : orig.call(this, req, ...rest); };
  try { require(mainPath); } finally { Module._load = orig; }
}
module.exports = { createFakeElectron, loadMainWith };
