const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog, ipcMain } = require('electron');
const cleanMessage = value => String(value).replace(/(?:https?|file):\/\/[^\s)"'<>]+/gi, '[url]')
  .replace(/(?:[A-Z]:[\\/]Users[\\/]|\/(?:Users|home)\/)[^\r\n/\\]+[\\/][^\s)"'<>]+/gi, '[path]')
    .replace(/(?:[A-Z]:[\\/]|\/(?:Users|home|Volumes|private|tmp|var|Applications)\/)[^\s)"'<>]+/gi, '[path]')
  .replace(/\bauthorization\s*[:=]\s*(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted]')
    .replace(/\b(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[redacted]').slice(0, 1000);
function sanitize(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 65536) throw new Error('Invalid diagnostic report.');
  const report = JSON.parse(raw);
  if (report?.schemaVersion !== 1 || !Array.isArray(report.failures) || report.failures.length > 32) throw new Error('Unsupported diagnostic report.');
  const allowed = new Set(['schemaVersion', 'createdAt', 'build', 'runtime', 'state', 'failures']);
  if (Object.keys(report).some(key => !allowed.has(key))) throw new Error('Unexpected diagnostic report field.');
  // Never retain save/player payloads, even if supplied by a modified renderer.
  const excluded = /^(?:character|player|inventory|items|stash|drops|save|raw|password|secret|token|authorization|apiKey)$/i;
  return JSON.parse(JSON.stringify(report, (key, value) => excluded.test(key) ? undefined : typeof value === 'string' ? cleanMessage(value) : value));
}
function installReporting(window, build) {
  const reportPath = path.join(app.getPath('userData'), 'diagnostics.json');
  const nativeFailures = [];
  let latest = { schemaVersion: 1, createdAt: new Date().toISOString(), build, state: { ready: false }, failures: [] };
  let writing = false;
  let pending;
  const report = () => ({ ...latest, build, createdAt: new Date().toISOString(),
    desktop: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch },
    failures: [...latest.failures, ...nativeFailures].slice(-32) });
  const retain = () => {
    pending = JSON.stringify(report(), null, 2);
    if (writing) return;
    writing = true;
    const writeLatest = async () => {
      while (pending) {
        const content = pending; pending = undefined;
        const temp = reportPath + '.pending';
        await fs.writeFile(temp, content); await fs.rename(temp, reportPath);
      }
    };
    writeLatest().catch(error => console.error('Unable to retain diagnostic report:', cleanMessage(error.message)))
      .finally(() => { writing = false; });
  };
  const trusted = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid diagnostic sender.');
    const url = new URL(event.senderFrame.url);
    if (url.protocol !== 'lantern:' || url.host !== 'app') throw new Error('Invalid diagnostic origin.');
  };
  ipcMain.on('diagnostics:update', (event, raw) => {
    try { trusted(event); latest = sanitize(raw); retain(); }
    catch (error) { console.error(cleanMessage(error.message)); }
  });
  ipcMain.handle('diagnostics:export', async (event, raw) => {
    trusted(event); latest = sanitize(raw); retain();
    const choice = await dialog.showSaveDialog(window, { title: 'Export diagnostic report', defaultPath: 'lantern-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePath) return false;
    await fs.writeFile(choice.filePath, JSON.stringify(report(), null, 2));
    return true;
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    nativeFailures.push({ at: new Date().toISOString(), kind: 'renderer-termination', message: cleanMessage(`${details.reason} (${details.exitCode})`) });
    if (nativeFailures.length > 32) nativeFailures.shift();
    retain();
    fs.writeFile(path.join(app.getPath('userData'), 'diagnostics-last-crash.json'), JSON.stringify(report(), null, 2))
      .catch(error => console.error('Unable to retain crash report:', cleanMessage(error.message)));
    // A native dialog works even when the renderer cannot present its export control.
    if (window.isDestroyed() || !window.isVisible()) return;
    dialog.showMessageBox(window, { type: 'error', title: 'Lantern stopped', message: 'Lantern stopped unexpectedly.', buttons: ['Export diagnostic report', 'Close'], defaultId: 0, cancelId: 1 }).then(async choice => {
      if (choice.response !== 0) return;
      const selected = await dialog.showSaveDialog(window, { defaultPath: 'lantern-diagnostics.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!selected.canceled && selected.filePath) await fs.writeFile(selected.filePath, JSON.stringify(report(), null, 2));
    }).catch(error => console.error('Unable to export diagnostic report:', cleanMessage(error.message)));
  });
  retain();
  window.on('closed', () => { ipcMain.removeAllListeners('diagnostics:update'); ipcMain.removeHandler('diagnostics:export'); });
}
module.exports = { installReporting, sanitize, cleanMessage };
