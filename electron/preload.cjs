// Sandboxed preload: expose only bounded local diagnostic operations.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lanternReporting', {
  runtime: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch },
  update: report => { if (typeof report === 'string' && report.length <= 65536) ipcRenderer.send('diagnostics:update', report); },
  export: report => ipcRenderer.invoke('diagnostics:export', report),
});
