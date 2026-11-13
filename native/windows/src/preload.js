'use strict';
// Trusted LOCAL toolbar only. Never attached to remote content.
const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed preload cannot require local modules: exact allowlist mirrors layout.MODE_ORDER.
const MODES = ['desktop', 'tablet', 'phone'];
contextBridge.exposeInMainWorld('orunShell', {
  setMode: (mode) => ipcRenderer.send('shell:set-mode', MODES.includes(mode) ? mode : 'desktop'),
  onMode: (cb) => ipcRenderer.on('shell:mode', (_e, m) => cb(m)),
  back: () => ipcRenderer.send('shell:back'),
  reload: () => ipcRenderer.send('shell:reload'),
  print: () => ipcRenderer.send('shell:print')
});
