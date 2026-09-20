/**
 * Desktop shell for CSV Inspector.
 *
 * The renderer runs the same static bundle that `npm run desktop:build`
 * writes to `out/`. It is served over a custom `app://` scheme rather than
 * `file://` for two reasons:
 *
 *   1. The Next.js export references its assets with absolute paths
 *      (`/_next/static/...`), which under `file://` would resolve against the
 *      filesystem root and 404.
 *   2. `file://` pages get an opaque origin, so `localStorage` — which the
 *      collapsible panels use to remember their state — is unreliable there.
 *      A registered standard scheme gives the app a stable origin.
 *
 * Files are read with `fs`, not `net.fetch`, because `fs` is asar-aware and
 * the export lives inside the packaged archive.
 */

import { app, BrowserWindow, Menu, protocol, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root of the exported site: `out/` next to this folder, packaged or not. */
const SITE_ROOT = path.join(here, '..', 'out');

const SCHEME = 'app';
const HOST = 'csv-inspector';
const ORIGIN = `${SCHEME}://${HOST}`;

/**
 * Content policy for the renderer. The app loads everything it needs from the
 * bundle, so the one outbound host allowed is the openFDA endpoint in
 * lib/ndc.ts. `blob:` covers the object URLs used to save generated files, and
 * the inline allowances are what the Next.js export's bootstrap scripts and
 * critical CSS require.
 */
const CSP = [
  "default-src 'self' blob:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' blob: https://api.fda.gov",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Must run before `app.whenReady()`. Marking the scheme standard and secure is
// what gives the page a real origin, `fetch`, and working storage APIs.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/**
 * Map a request path onto a file inside `out/`, refusing anything that escapes
 * it. Returns null when the path is outside the export.
 * @param {string} pathname
 * @returns {string | null}
 */
function resolveWithinSite(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed percent-encoding; there is no file it could mean.
    return null;
  }
  const relative = path.normalize(decoded).replace(/^([/\\])+/, '');
  const resolved = path.join(SITE_ROOT, relative);
  if (resolved !== SITE_ROOT && !resolved.startsWith(SITE_ROOT + path.sep)) return null;
  return resolved.endsWith(path.sep) || relative === '' ? path.join(resolved, 'index.html') : resolved;
}

/**
 * @param {string} file
 * @param {number} status
 * @returns {Promise<Response | null>}
 */
async function respondWithFile(file, status) {
  try {
    const body = await readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const headers = { 'content-type': type };
    if (type.startsWith('text/html')) headers['content-security-policy'] = CSP;
    return new Response(body, { status, headers });
  } catch {
    return null;
  }
}

/** @param {Request} request */
async function serve(request) {
  // `new URL` drops the query string, which the export appends to /icon.svg.
  const target = resolveWithinSite(new URL(request.url).pathname);
  if (!target) return new Response('Forbidden', { status: 403 });

  const direct = await respondWithFile(target, 200);
  if (direct) return direct;

  // A directory-style path ("/foo" or "/foo/") falls back to its HTML file.
  const asHtml =
    (await respondWithFile(path.join(target, 'index.html'), 200)) ??
    (path.extname(target) ? null : await respondWithFile(`${target}.html`, 200));
  if (asHtml) return asHtml;

  return (
    (await respondWithFile(path.join(SITE_ROOT, '404.html'), 404)) ??
    new Response('Not found', { status: 404 })
  );
}

/**
 * Open http(s) links in the user's browser instead of in a second Electron
 * window, and never let the app window navigate away from the bundled site.
 * @param {Electron.WebContents} contents
 */
function keepNavigationInside(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === ORIGIN) return;
    event.preventDefault();
    if (url.startsWith('https://')) void shell.openExternal(url);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: '#ffffff',
    show: false,
    title: 'CSV Inspector',
    icon: path.join(here, '..', 'build', 'icon.png'),
    webPreferences: {
      // The app needs no Node access at all: everything it does — parsing,
      // profiling, script generation — is plain browser code.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  keepNavigationInside(window.webContents);
  void window.loadURL(`${ORIGIN}/index.html`);
  return window;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'openFDA NDC directory',
          click: () => void shell.openExternal('https://open.fda.gov/apis/drug/ndc/'),
        },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window per launch; a second instance just focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (!existing) return;
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  });

  void app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);

    app.on('web-contents-created', (_event, contents) => keepNavigationInside(contents));

    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
