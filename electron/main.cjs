// Packaged/local desktop shell. No remote content or native renderer privileges.
const { app, BrowserWindow, Menu, screen, protocol } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { installReporting } = require('./reporting.cjs');
const root = path.resolve(__dirname, '../dist');
const flag = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const background = process.argv.includes('--background');
if (background && process.platform === 'darwin') app.setActivationPolicy('accessory');
const backend = flag('renderer', '');
if (backend && backend !== 'webgpu') throw new Error('Lantern requires native WebGPU; renderer selection is no longer supported.');
app.setName('Lantern');
const profile = background ? path.resolve(__dirname, `../.local/electron-check-${flag('debug-port', 'default')}`) : path.join(app.getPath('appData'), 'Lantern');
require('node:fs').mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'lantern', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const debugPort = flag('debug-port', '');
if (debugPort) {
  if (!/^\d+$/.test(debugPort)) throw new Error('debug-port must be numeric');
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
app.whenReady().then(async () => {
  if (background && process.platform === 'darwin') app.dock.hide();
  await fs.access(path.join(root, 'index.html'));
  protocol.handle('lantern', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app') return new Response('Unavailable', { status: 403 });
      const pathname = decodeURIComponent(url.pathname);
      const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + path.sep)) return new Response('Unavailable', { status: 403 });
      const data = await fs.readFile(file);
      return new Response(data, { headers: { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' } });
    } catch { return new Response('Asset unavailable', { status: 404 }); }
  });
  const origin = 'lantern://app';
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const minimumViewport = { width: 1280, height: 800 };
  const width = Math.min(minimumViewport.width, area.width);
  const height = Math.min(900, area.height);
  const window = new BrowserWindow({ width, height, useContentSize: true, x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), show: false, focusable: !background, skipTaskbar: background, backgroundColor: '#111e24', title: 'Lantern', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, focusOnNavigation: !background } });
  // UI support is measured in content pixels, not the operating-system frame.
  const outer = window.getBounds(), content = window.getContentBounds();
  const frameWidth = outer.width - content.width, frameHeight = outer.height - content.height;
  const contentWidth = Math.max(1, Math.min(width, area.width - frameWidth));
  const contentHeight = Math.max(1, Math.min(height, area.height - frameHeight));
  window.setContentSize(contentWidth, contentHeight);
  window.setMinimumSize(Math.min(minimumViewport.width, contentWidth) + frameWidth, Math.min(minimumViewport.height, contentHeight) + frameHeight);
  let build = { version: app.getVersion(), revision: 'development', dirty: true };
  try { build = JSON.parse(await fs.readFile(path.join(root, 'build-identity.json'), 'utf8')); } catch { /* Local development builds may precede candidate preparation. */ }
  installReporting(window, build);
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).protocol !== 'lantern:' || new URL(url).host !== 'app') event.preventDefault(); });
  window.webContents.on('console-message', (details) => { if (['warning', 'error'].includes(details.level)) console.error(`[renderer] ${details.message}`); });
  if (!background) window.on('ready-to-show', () => window.show());
  const setHidden = hidden => { void window.webContents.executeJavaScript(`document.documentElement.toggleAttribute('data-window-hidden', ${hidden}); window.dispatchEvent(new Event('lanternvisibilitychange'));`).catch(() => {}); };
  if (!background) {
    window.on('minimize', () => setHidden(true)); window.on('hide', () => setHidden(true));
    window.on('restore', () => setHidden(false)); window.on('show', () => setHidden(false));
  }
  const query = new URLSearchParams();
  if (background) query.set('inspection', 'render');
  if (Number.isFinite(display.displayFrequency) && display.displayFrequency > 0) query.set('displayHz', String(display.displayFrequency));
  await window.loadURL(`${origin}/?${query}`);
  console.log('Desktop window', JSON.stringify({ background, visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds(), workArea: area }));
  console.log(`Lantern Electron ${process.versions.electron}: ${origin} (native WebGPU)`);
}).catch((error) => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
