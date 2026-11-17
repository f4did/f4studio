// F4 Studio desktop shell (Electron). Serves the built app from ../dist on a local port with the
// COOP/COEP headers FFmpeg.wasm needs, so exports work exactly like in the browser.
const { app, BrowserWindow, shell, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIST = fs.existsSync(path.join(__dirname, 'dist')) ? path.join(__dirname, 'dist') : path.join(__dirname, '..', 'dist');
const APP_ICON = path.join(__dirname, 'icon.ico');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.normalize(path.join(DIST, p));
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

let win;
async function createWindow() {
  const port = await serve();
  // Allow camera / microphone / screen capture for the recorder; deny everything else.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)));
  win = new BrowserWindow({ width: 1500, height: 920, minWidth: 900, minHeight: 600, backgroundColor: '#0b0b0b', title: 'F4 Studio', icon: APP_ICON, autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.setName('F4 Studio');
app.setAppUserModelId('studio.f4.editor');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
