// Da’imun for Linux: a tray app that hosts the shared web app (web/) and fires its alarms on time,
// like the Mac and Windows apps. It speaks the Windows bridge, so the web code is the same.
'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, protocol, net, screen, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const pkg = require('./package.json');
const VERSION = pkg.version;
const BUILD = Number(pkg.daimunBuild) || 0;
const FEED = 'https://zaytage.github.io/daimun/update.json';
const WEB = path.join(__dirname, 'web');
const ORIGIN = 'app://daimun';
const has = (flag) => process.argv.includes(flag);

app.setName('Daimun');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Ubuntu 23.10+ blocks the sandbox Chromium wants for AppImages. Da’imun only shows its own bundled
// pages (other addresses open in the browser), so it runs without that sandbox, as many AppImages do.
app.commandLine.appendSwitch('no-sandbox');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ------------------------------------------------------------------ storage (~/.config/Daimun)
const dataDir = () => app.getPath('userData');
const file = (n) => path.join(dataDir(), n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (e) { return d; } };
const writeFile = (n, s) => { try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(file(n) + '.tmp', s); fs.renameSync(file(n) + '.tmp', file(n)); } catch (e) { /* disk full or read-only */ } };
let dataJson = null;
let events = [];
let fired = {};
let today = null;
let style = 'fullscreen', alarmSound = 'adhan', reminderSound = true;

// ------------------------------------------------------------------ start with the desktop (~/.config/autostart)
const appImage = () => process.env.APPIMAGE || process.execPath;
const autostartFile = path.join(os.homedir(), '.config', 'autostart', 'daimun.desktop');
const login = {
  get enabled() { return fs.existsSync(autostartFile); },
  set(on) {
    try {
      if (on) {
        fs.mkdirSync(path.dirname(autostartFile), { recursive: true });
        fs.writeFileSync(autostartFile, desktopEntry('--background'));
      } else if (fs.existsSync(autostartFile)) fs.unlinkSync(autostartFile);
    } catch (e) { /* no autostart folder: leave it */ }
  },
};
function desktopEntry(args) {
  return ['[Desktop Entry]', 'Type=Application', 'Name=Da’imun', 'Comment=The adhan on your laptop and a daily ibadah chart',
    `Exec="${appImage()}"${args ? ' ' + args : ''}`, 'Icon=daimun', 'Terminal=false', 'Categories=Utility;', 'StartupWMClass=Daimun', 'X-GNOME-Autostart-enabled=true', ''].join('\n');
}
/** Show Da’imun in the applications menu, pointing at wherever the AppImage is now. */
function integrateWithDesktop(firstRun) {
  try {
    const share = path.join(os.homedir(), '.local', 'share');
    const iconDir = path.join(share, 'icons', 'hicolor', '512x512', 'apps');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.copyFileSync(path.join(WEB, 'icons', 'icon-512.png'), path.join(iconDir, 'daimun.png'));
    fs.mkdirSync(path.join(share, 'applications'), { recursive: true });
    fs.writeFileSync(path.join(share, 'applications', 'daimun.desktop'), desktopEntry(''));
    if (firstRun) login.set(true); // an alarm app should start with the computer; it can be turned off in Settings
    else if (login.enabled) login.set(true); // keep the start-up entry pointing at this copy
  } catch (e) { /* not fatal */ }
}

// ------------------------------------------------------------------ windows
let main = null, tray = null, pageReady = false, quitting = false;
const pending = [];
let overlay = [], overlayEvent = null, toast = null, toastTimer = null;

function runJs(js) {
  if (pageReady && main && !main.isDestroyed()) main.webContents.executeJavaScript(js).catch(() => {});
  else pending.push(js);
}
const sendToPage = (action, e) => runJs(`window.Istiqamah && window.Istiqamah.nativeAction(${JSON.stringify(action)}, ${JSON.stringify(e)})`);
const sendNativeInfo = () => runJs(`window.Istiqamah && window.Istiqamah.setNativeInfo(${JSON.stringify({ login: login.enabled, version: VERSION })})`);

const secure = {
  preload: path.join(__dirname, 'preload.js'), contextIsolation: false, nodeIntegration: false, sandbox: false,
  backgroundThrottling: false, spellcheck: false,
};
function lockDown(win) {
  win.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith(ORIGIN)) { ev.preventDefault(); openUrl(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { openUrl(url); return { action: 'deny' }; });
}
function openUrl(url) { if (/^(https?:|mailto:)/.test(url || '')) shell.openExternal(url).catch(() => {}); }

function createMain() {
  main = new BrowserWindow({ width: 1060, height: 820, minWidth: 380, minHeight: 500, show: false, title: 'Da’imun', backgroundColor: '#f4f0e6',
    icon: path.join(WEB, 'icons', 'icon-512.png'), autoHideMenuBar: true, webPreferences: secure });
  main.setMenuBarVisibility(false);
  lockDown(main);
  main.on('close', (ev) => { if (!quitting) { ev.preventDefault(); main.hide(); setTimeout(updater.installWhenQuiet, 1000); } });
  main.webContents.on('render-process-gone', () => { pageReady = false; main.reload(); });
  main.loadURL(`${ORIGIN}/index.html`);
}
function showMain() { if (!main) return; main.show(); main.focus(); }

function payload(e, mode, stale) {
  return encodeURIComponent(Buffer.from(JSON.stringify({ event: e, mode, stale, alarmSound, reminderSound })).toString('base64'));
}
function alertWindow(opts, e, mode, stale) {
  const win = new BrowserWindow(Object.assign({ frame: false, show: false, skipTaskbar: true, alwaysOnTop: true, resizable: false,
    title: 'Da’imun', backgroundColor: '#082824', webPreferences: secure }, opts));
  win.setAlwaysOnTop(true, 'screen-saver');
  lockDown(win);
  win.__event = e;
  win.loadURL(`${ORIGIN}/alert.html#${payload(e, mode, stale)}`);
  return win;
}
function showOverlay(e, popup, stale) {
  closeOverlay();
  overlayEvent = e;
  const displays = popup ? [screen.getDisplayNearestPoint(screen.getCursorScreenPoint())] : screen.getAllDisplays();
  displays.forEach((d, i) => {
    const b = d.bounds;
    const opts = popup
      ? { width: 560, height: 660, x: Math.round(b.x + (b.width - 560) / 2), y: Math.round(b.y + (b.height - 660) / 2) }
      : { x: b.x, y: b.y, width: b.width, height: b.height, fullscreen: true };
    const win = alertWindow(opts, e, popup ? 'popup' : 'overlay', stale || i > 0);
    win.once('ready-to-show', () => { win.show(); if (i === 0) win.focus(); });
    overlay.push(win);
  });
}
function closeOverlay() { overlay.forEach((w) => { if (!w.isDestroyed()) w.destroy(); }); overlay = []; overlayEvent = null; }
function closeOverlayIfGone() {
  if (!overlayEvent || overlayEvent.test) return;
  const key = overlayEvent.group || overlayEvent.id;
  if (!events.some((x) => (x.group || x.id) === key)) closeOverlay();
}
function showToast(e, persistent, stale) {
  closeToast();
  const wa = screen.getPrimaryDisplay().workArea;
  toast = alertWindow({ width: 380, height: 220, x: wa.x + wa.width - 380 - 12, y: wa.y + 12, focusable: false }, e, 'toast', stale);
  toast.once('ready-to-show', () => { if (toast && !toast.isDestroyed()) toast.showInactive(); });
  const secs = Number(e.autoClose) || 0;
  if (secs > 0 && !persistent) toastTimer = setTimeout(closeToast, secs * 1000);
}
function closeToast() { clearTimeout(toastTimer); toastTimer = null; if (toast && !toast.isDestroyed()) toast.destroy(); toast = null; }
function tell(title, body) {
  const now = Date.now();
  showToast({ id: 'info-' + now, at: now, until: now + 600000, kind: 'info', title, body, autoClose: 25, actions: [{ id: 'dismiss', label: 'OK' }] }, false, false);
}

// ------------------------------------------------------------------ messages
ipcMain.on('initial-data', (ev) => { ev.returnValue = ev.sender === (main && main.webContents) ? dataJson : null; });

ipcMain.on('page-message', (ev, s) => {
  let m; try { m = JSON.parse(s); } catch (e) { return; }
  if (!m) return;
  const from = BrowserWindow.fromWebContents(ev.sender);
  if (main && from === main) return onPageMessage(m);
  if (from) onAlertMessage(from, m);
});

function onPageMessage(m) {
  switch (m.type) {
    case 'ready':
      pageReady = true;
      pending.splice(0).forEach(runJs);
      sendNativeInfo();
      break;
    case 'schedule':
      if (Array.isArray(m.events)) { events = m.events.filter((e) => e && e.at > 0 && e.until > 0); writeFile('schedule.json', JSON.stringify(events)); }
      if (m.style) style = m.style;
      if (m.alarmSound) alarmSound = m.alarmSound;
      if ('reminderSound' in m) reminderSound = !!m.reminderSound;
      if (m.today) today = m.today;
      closeOverlayIfGone();
      tick();
      break;
    case 'save':
      if (typeof m.data === 'string') { dataJson = m.data; writeFile('data.json', m.data); }
      break;
    case 'fire': if (m.event) present(m.event, false); break;
    case 'show': if (m.event) showToast(m.event, false, false); break;
    case 'setLogin': login.set(!!m.on); sendNativeInfo(); break;
    case 'openURL': openUrl(m.url); break;
  }
}

function onAlertMessage(win, m) {
  const e = win.__event || {};
  if (m.type === 'action') onAlertAction(m.action, e);
  else if (m.type === 'close') { if (win === toast) closeToast(); else closeOverlay(); }
  else if (m.type === 'size' && win === toast) {
    const wa = screen.getPrimaryDisplay().workArea, h = Math.min(Math.ceil(Number(m.h) || 200) + 2, wa.height - 40);
    toast.setBounds({ x: wa.x + wa.width - 380 - 12, y: wa.y + 12, width: 380, height: h });
  }
}

const isPrayer = (e) => e.kind === 'prayer' || e.kind === 'nag';
function onAlertAction(action, e) {
  if (!action || action === 'stop') return;
  if (isPrayer(e) || e.fullscreen) closeOverlay();
  if (action === 'open') { showMain(); runJs('window.Istiqamah && window.Istiqamah.showToday()'); }
  sendToPage(action, e);
}

// ------------------------------------------------------------------ alarms
function present(e, stale) {
  if (isPrayer(e)) { if (style === 'notification') showToast(e, true, stale); else showOverlay(e, style === 'popup', stale); }
  else if (e.fullscreen) showOverlay(e, style === 'popup', stale);
  else showToast(e, false, stale);
}
function tick() {
  const now = Date.now();
  const due = events.filter((e) => e.at <= now && now <= e.until && e.id && !fired[e.id]);
  if (due.length) {
    const latest = new Map();
    for (const e of due) {
      fired[e.id] = now;
      const g = e.group || e.id, c = latest.get(g);
      if (!c || c.at < e.at) latest.set(g, e);
    }
    const cutoff = now - 3 * 86400000;
    for (const k of Object.keys(fired)) if (fired[k] < cutoff) delete fired[k];
    writeFile('fired.json', JSON.stringify(fired));
    [...latest.values()].sort((a, b) => a.at - b.at).forEach((e) => present(e, now - e.at > 180000));
  }
  updateTray();
}

// ------------------------------------------------------------------ tray
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function currentPending(now) {
  if (!today || today.paused || !Array.isArray(today.prayers)) return null;
  return today.prayers.find((p) => p.key !== 'sunrise' && !p.status && p.at <= now && now < p.end) || null;
}
function trayText() {
  const now = Date.now(), cur = currentPending(now);
  if (cur) return `Da’imun · ${cur.name} has come in`;
  if (today && Array.isArray(today.prayers)) {
    let next = today.prayers.find((p) => p.at > now), name = next && next.name, at = next && next.at;
    if (!next && today.nextFajr > now) { name = 'Fajr'; at = today.nextFajr; }
    if (name) { const mins = Math.ceil((at - now) / 60000); return mins <= 60 ? `Da’imun · ${name} in ${mins} min` : `Da’imun · ${name} at ${clock(at)}`; }
  }
  return 'Da’imun';
}
let lastMenuKey = '';
function updateTray() {
  if (!tray) return;
  tray.setToolTip(trayText());
  const now = Date.now(), cur = currentPending(now);
  const key = JSON.stringify([today && today.prayers && today.prayers.map((p) => [p.key, p.at, p.status]), cur && cur.key, login.enabled, Math.floor(now / 60000)]);
  if (key === lastMenuKey) return;
  lastMenuKey = key;
  const items = [{ label: trayText(), enabled: false }, { type: 'separator' }];
  if (today && Array.isArray(today.prayers) && today.prayers.length) {
    const nextKey = (today.prayers.find((p) => p.at > now) || {}).key;
    items.push({ label: 'Today' + (today.place ? ' · ' + today.place : ''), enabled: false });
    for (const p of today.prayers) {
      items.push({ label: `${p.key === nextKey ? '▸ ' : ''}${p.name}  ${clock(p.at)}${p.status && p.status !== 'missed' ? '  ✓' : ''}`, click: showMain });
    }
    if (cur) {
      items.push({ type: 'separator' }, { label: `I've prayed ${cur.name}`, click: () => sendToPage('prayed', { id: 'menu', kind: 'prayer', prayer: cur.key, dateKey: cur.dateKey, group: `${cur.dateKey}:${cur.key}`, title: cur.name }) });
    }
  } else items.push({ label: 'Choose your city to get started…', click: showMain });
  items.push({ type: 'separator' },
    { label: 'Open Da’imun', click: showMain },
    { label: 'Test the alarm', click: () => runJs('window.Istiqamah && window.Istiqamah.testAlarm()') },
    { label: 'Open when I log in', type: 'checkbox', checked: login.enabled, click: () => { login.set(!login.enabled); sendNativeInfo(); lastMenuKey = ''; updateTray(); } },
    { type: 'separator' },
    { label: 'Check for updates…', click: () => updater.check(true) },
    { label: `Version ${VERSION}`, enabled: false },
    { label: 'Quit Da’imun', click: quit });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
function quit() { quitting = true; closeOverlay(); closeToast(); if (tray) tray.destroy(); app.quit(); }

// ------------------------------------------------------------------ updates: replace the AppImage in place
const updater = {
  ready: null, checking: false,
  async check(userInitiated) {
    if (this.checking) return;
    this.checking = true;
    try {
      const res = await net.fetch(`${FEED}?t=${Date.now()}`, { headers: { 'User-Agent': `Daimun/${VERSION}` }, cache: 'no-store' });
      if (!res.ok) throw new Error(`The update server answered ${res.status}.`);
      const info = (await res.json()).linux;
      if (!info || !(Number(info.build) > BUILD)) { if (userInitiated) tell('Da’imun is up to date', `You have the latest version, ${VERSION}.`); return; }
      if (!process.env.APPIMAGE) { if (userInitiated) tell(`Version ${info.version} is available`, 'Download it again from zaytage.github.io/daimun.'); return; }
      const dl = await net.fetch(info.url);
      if (!dl.ok) throw new Error(`The download answered ${dl.status}.`);
      const buf = Buffer.from(await dl.arrayBuffer());
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      if (sha !== String(info.sha256).toLowerCase()) throw new Error("The download didn't match its published fingerprint, so it wasn't installed.");
      const target = process.env.APPIMAGE, next = target + '.new';
      fs.writeFileSync(next, buf, { mode: 0o755 });
      this.ready = { next, target, info };
      this.installWhenQuiet();
    } catch (err) {
      if (userInitiated) tell("Couldn't check for updates", String(err && err.message || err));
      else setTimeout(() => updater.check(false), 20 * 60000); // offline or a hiccup: try again in 20 minutes
    } finally { this.checking = false; }
  },
  installWhenQuiet() {
    const r = updater.ready;
    if (!r) return;
    if (overlay.length || (main && main.isVisible())) { setTimeout(updater.installWhenQuiet, 120000); return; }
    try {
      fs.renameSync(r.next, r.target); // Linux lets a running program's file be replaced
      writeFile('updated.json', JSON.stringify({ version: r.info.version, notes: r.info.notes || '' }));
      spawn(r.target, ['--updated', '--background'], { detached: true, stdio: 'ignore' }).unref();
      quit();
    } catch (err) { tell("Couldn't install the update", String(err && err.message || err)); updater.ready = null; }
  },
  announceIfJustUpdated() {
    if (!has('--updated')) return;
    const u = readJson('updated.json', null);
    if (!u) return;
    try { fs.unlinkSync(file('updated.json')); } catch (e) { /* ignore */ }
    setTimeout(() => tell(`Da’imun updated to version ${u.version}`, u.notes || ''), 2500);
  },
};

// ------------------------------------------------------------------ start
app.on('second-instance', showMain);
app.on('window-all-closed', (ev) => ev.preventDefault && ev.preventDefault()); // keep running in the tray
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const p = path.normalize(path.join(WEB, decodeURIComponent(u.pathname)));
    if (!p.startsWith(WEB)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  });
  try { dataJson = fs.readFileSync(file('data.json'), 'utf8'); JSON.parse(dataJson); } catch (e) { dataJson = null; }
  events = readJson('schedule.json', []);
  fired = readJson('fired.json', {});
  integrateWithDesktop(dataJson == null && !fs.existsSync(file('fired.json')));

  const icon = nativeImage.createFromPath(path.join(WEB, 'icons', 'icon-192.png')).resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.on('click', showMain);
  createMain();
  updateTray();
  if (dataJson == null || !has('--background')) main.once('ready-to-show', showMain);
  if (has('--test-alarm')) runJs('window.Istiqamah && window.Istiqamah.testAlarm()');
  updater.announceIfJustUpdated();

  setInterval(tick, 10000);
  setInterval(() => runJs('window.Istiqamah && window.Istiqamah.pushSchedule()'), 300000);
  setInterval(() => updater.check(false), 3 * 3600000);
  setTimeout(() => updater.check(false), 45000);
  powerMonitor.on('resume', () => { runJs('window.Istiqamah && window.Istiqamah.pushSchedule()'); setTimeout(tick, 3000); setTimeout(() => updater.check(false), 30000); });
});
