// Local renderer experiment. No Steam SDK, remote content, or native renderer privileges.
const { app, BrowserWindow, Menu, screen } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist');
const flag = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const background = process.argv.includes('--background');
if (background && process.platform === 'darwin') app.setActivationPolicy('accessory');
const backend = flag('renderer', ['fxaa', 'smaa', 'msaa'].includes(flag('aa', '')) ? 'webgl' : 'webgpu');
const aa = flag('aa', backend === 'webgpu' ? 'traa' : 'fxaa');
const debugPort = flag('debug-port', '');
if (debugPort) {
  if (!/^\d+$/.test(debugPort)) throw new Error('debug-port must be numeric');
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', debugPort);
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
let server;
app.whenReady().then(async () => {
  if (background && process.platform === 'darwin') app.dock.hide();
  await fs.access(path.join(root, 'index.html'));
  server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const data = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(data);
    } catch { response.writeHead(404).end('Local asset unavailable'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(1280, Math.floor(area.width * 0.9));
  const height = Math.min(900, Math.floor(area.height * 0.9));
  const window = new BrowserWindow({ width, height, x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), minWidth: Math.min(800, width), minHeight: Math.min(560, height), show: false, focusable: !background, skipTaskbar: background, backgroundColor: '#111e24', title: 'Lantern — Renderer comparison', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, focusOnNavigation: !background } });
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  window.webContents.on('console-message', (details) => { if (['warning', 'error'].includes(details.level)) console.error(`[renderer] ${details.message}`); });
  if (!background) window.on('ready-to-show', () => window.show());
  await window.loadURL(`${origin}/?renderer=${encodeURIComponent(backend)}&aa=${encodeURIComponent(aa)}`);
  console.log('Desktop window', JSON.stringify({ background, visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds(), workArea: area }));
  console.log(`Lantern Electron ${process.versions.electron}: ${origin} (${backend}/${aa})`);
}).catch((error) => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server?.close());
