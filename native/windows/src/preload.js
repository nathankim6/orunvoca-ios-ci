'use strict';
// Trusted LOCAL toolbar only. Never attached to remote content.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orunShell', {
  setMode: (mode) => ipcRenderer.send('shell:set-mode', mode === 'phone' ? 'phone' : 'desktop'),
  onMode: (cb) => ipcRenderer.on('shell:mode', (_e, m) => cb(m)),
  back: () => ipcRenderer.send('shell:back'),
  reload: () => ipcRenderer.send('shell:reload'),
  print: () => ipcRenderer.send('shell:print')
});
