/**
 * Console Windows d'AfriKaisse (phase 16, §51) : icône de la zone de notification, caisse plein écran,
 * état du système, appairage des tablettes par QR, sauvegarde, démarrage avec Windows.
 *
 * La console n'est PAS le serveur : celui-ci tourne dans la tâche planifiée « AfriKaisse\Serveur »
 * (infrastructure/windows/lanceur/tache.cjs), avant toute ouverture de session. Quitter la console ne
 * l'arrête pas. Les écrans viennent de l'application web servie par ce serveur (aucun écran refait ici),
 * sauf deux petites fenêtres locales : attente et appairage.
 *
 * Sécurité : isolation de contexte, bac à sable, pas de Node dans les pages ; navigation limitée au
 * serveur local de ce PC et aux fichiers de la console ; liens externes vers le navigateur de Windows.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type WebPreferences } from 'electron';
import { toDataURL } from 'qrcode';
import * as commun from '../../../infrastructure/windows/lanceur/commun.cjs';
import { resolveInstall } from './chemins.ts';
import { appUrl, isAppUrl, isExternalLink, isLocalWindowUrl, type AppSection } from './navigation.ts';
import { rankLanUrls } from './reseau.ts';
import { errorSummary, formatSize, parseBackupOutput } from './sauvegarde.ts';

const APP_ID = 'GlobalTech.AfriKaisse.Console';
const WINDOWS_DIR = join(__dirname, 'fenetres');
const PRELOAD = join(__dirname, 'preload.cjs');
const ICON = existsSync(join(__dirname, 'afrikaisse.ico')) ? join(__dirname, 'afrikaisse.ico') : join(__dirname, 'afrikaisse.png');
/** Ouverture de session Windows : icône seulement, aucune fenêtre. */
const HIDDEN_START = process.argv.includes('--cache');
const LOGIN_ITEM = { path: process.execPath, args: ['--cache'] };
const STATUS_EVERY_MS = 15_000;
const BACKUP_TIMEOUT_MS = 5 * 60_000;
const SECTION_TITLES: Record<AppSection, string> = { caisse: 'AfriKaisse', supervision: 'AfriKaisse — État du système' };
/** Permissions accordées à l'application web (et à elle seule) : copier, plein écran. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

const install = resolveInstall(process.execPath, process.env, app.isPackaged);
const files = commun.paths(commun.dataDir(process.env));

interface Server extends commun.PortInfo {
  health: commun.Health;
}

interface Waiting {
  etat: 'demarrage' | 'echec';
  message: string;
  detail?: string;
}

let tray: Tray | null = null;
let known: Server | null = null;
let starting: Promise<Server | null> | null = null;
let waiting: Waiting = { etat: 'demarrage', message: 'Recherche du serveur AfriKaisse…' };
let backupRunning = false;
let pairingWindow: BrowserWindow | null = null;
const sectionWindows = new Map<AppSection, BrowserWindow>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------
// Serveur local
// ---------------------------------------------------------------------------------------------------

/** Le serveur de CE PC répond-il ? Le port vient du fichier écrit par le serveur (jamais de port en dur). */
async function probe(): Promise<Server | null> {
  const info = commun.readPortFile(files.portFile);
  const health = info ? await commun.fetchHealth(info.port, 2500) : null;
  const next = info && commun.isOwnHealth(health, info.nodeId) ? { ...info, health } : null;
  const changed = (next?.port ?? null) !== (known?.port ?? null);
  known = next;
  if (changed) refreshTray();
  return known;
}

/** Superviseur ou serveur déjà en route (démarrage, migrations) : ne jamais en lancer un second. */
async function processesRunning(): Promise<boolean> {
  for (const file of [files.supervisorPid, files.serverPid]) {
    const pid = commun.readPid(file);
    if (pid && (await commun.isNodeProcess(pid, true))) return true;
  }
  return false;
}

function canLaunch(): boolean {
  return !!install.nodeExe && !!install.launcher && existsSync(install.nodeExe) && existsSync(install.launcher);
}

/** Repli : le lanceur navigateur, sans navigateur. Le superviseur adoptera ce serveur sans le doubler. */
function launchFallback() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(install.nodeExe!, [install.launcher!, '--sans-navigateur'], { cwd: install.app ?? undefined, env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function setWaiting(next: Waiting) {
  waiting = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && isLocalWindowUrl(win.webContents.getURL(), WINDOWS_DIR)) win.webContents.send('afk:attente', waiting);
  }
}

async function startServer(): Promise<Server | null> {
  if (await probe()) return known;
  const firstRun = !existsSync(files.database);
  setWaiting({ etat: 'demarrage', message: firstRun ? 'Première installation : préparation de la base…' : 'Démarrage du serveur du restaurant…' });

  const task = await commun.taskInstalled();
  // Un compte sans droit peut être refusé : Windows relance de toute façon la tâche toutes les 5 minutes.
  if (task) await commun.runTask();
  const launchable = canLaunch();
  if (!task && !launchable) {
    setWaiting({ etat: 'echec', message: "Serveur AfriKaisse introuvable : AfriKaisse n'est pas installé sur ce PC.", detail: files.data });
    return null;
  }

  let fallbackAt = task ? Date.now() + 20_000 : Date.now();
  const deadline = Date.now() + (firstRun ? 180_000 : 90_000);
  while (Date.now() < deadline) {
    if (await probe()) return known;
    if (fallbackAt && Date.now() >= fallbackAt) {
      fallbackAt = 0;
      if (launchable && !(await processesRunning())) launchFallback();
    }
    await sleep(1000);
  }
  setWaiting({ etat: 'echec', message: 'Le serveur AfriKaisse ne répond pas.', detail: join(files.logs, 'serveur.log') });
  return null;
}

function ensureServer(): Promise<Server | null> {
  if (!starting) {
    starting = startServer().finally(() => {
      starting = null;
      refreshTray();
    });
    refreshTray();
  }
  return starting;
}

// ---------------------------------------------------------------------------------------------------
// Fenêtres de l'application web (caisse, supervision)
// ---------------------------------------------------------------------------------------------------

function webPreferences(): WebPreferences {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, devTools: !app.isPackaged };
}

async function showWaiting(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  if (!isLocalWindowUrl(win.webContents.getURL(), WINDOWS_DIR)) await win.loadFile(join(WINDOWS_DIR, 'attente.html')).catch(() => undefined);
  if (!win.isDestroyed()) win.webContents.send('afk:attente', waiting);
}

async function loadSection(win: BrowserWindow, section: AppSection) {
  let server = await probe();
  if (!server) {
    await showWaiting(win);
    server = await ensureServer();
    if (!server || win.isDestroyed()) return;
  }
  // Échec de chargement : did-fail-load prend le relais.
  await win.loadURL(appUrl(server.port, section)).catch(() => undefined);
}

function createSectionWindow(section: AppSection): BrowserWindow {
  const win = new BrowserWindow({
    title: SECTION_TITLES[section],
    width: section === 'caisse' ? 1366 : 1200,
    height: section === 'caisse' ? 820 : 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: ICON,
    backgroundColor: '#F4F4F4',
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  sectionWindows.set(section, win);
  win.on('page-title-updated', (event) => event.preventDefault());
  win.once('ready-to-show', () => {
    if (section === 'caisse') win.maximize();
    win.show();
  });
  win.on('closed', () => sectionWindows.delete(section));

  let failures = 0;
  win.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !url.startsWith('http')) return; // -3 : navigation remplacée
    failures += 1;
    known = null;
    if (failures > 3) {
      failures = 0;
      setWaiting({ etat: 'echec', message: 'Le serveur AfriKaisse ne répond pas.', detail: join(files.logs, 'serveur.log') });
      void showWaiting(win);
      return;
    }
    void showWaiting(win);
    setTimeout(() => !win.isDestroyed() && void loadSection(win, section), 2_000);
  });
  win.webContents.on('did-finish-load', () => {
    if (isAppUrl(win.webContents.getURL(), known?.port ?? null)) failures = 0;
  });
  win.webContents.on('render-process-gone', () => !win.isDestroyed() && win.webContents.reload());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F5') {
      win.webContents.reload();
      event.preventDefault();
    }
  });
  return win;
}

async function openSection(section: AppSection) {
  const existing = sectionWindows.get(section);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    const onApp = isAppUrl(existing.webContents.getURL(), known?.port ?? null);
    // La caisse garde son écran ; l'état du système revient toujours sur la Supervision.
    if (onApp && section === 'caisse') return;
    return loadSection(existing, section);
  }
  await loadSection(createSectionWindow(section), section);
}

// ---------------------------------------------------------------------------------------------------
// Appairage d'une tablette (§52)
// ---------------------------------------------------------------------------------------------------

function openPairing() {
  if (pairingWindow && !pairingWindow.isDestroyed()) {
    pairingWindow.show();
    pairingWindow.focus();
    pairingWindow.webContents.send('afk:actualiser');
    return;
  }
  const win = new BrowserWindow({
    title: 'Appairer une tablette',
    width: 660,
    height: 560,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    icon: ICON,
    backgroundColor: '#FFFFFF',
    // Barre de titre WEBDEV : bleue, croix blanche (boutons natifs de Windows par-dessus).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#065FD4', symbolColor: '#FFFFFF', height: 40 },
    webPreferences: webPreferences(),
  });
  pairingWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => (pairingWindow = null));
  void win.loadFile(join(WINDOWS_DIR, 'appairage.html'));
}

async function pairingInfo() {
  const server = (await probe()) ?? (await ensureServer());
  if (!server) return { ok: false as const, message: waiting.message, detail: waiting.detail ?? null };
  const addresses = rankLanUrls(server.health.lanUrls ?? [], networkInterfaces());
  return {
    ok: true as const,
    version: server.health.version,
    configured: server.health.configured !== false,
    addresses: await Promise.all(
      addresses.map(async (address) => ({ ...address, qr: await toDataURL(address.url, { errorCorrectionLevel: 'M', margin: 2, width: 248, color: { dark: '#000000', light: '#FFFFFF' } }) })),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------
// Sauvegarde, zone de notification, démarrage avec Windows
// ---------------------------------------------------------------------------------------------------

function notify(title: string, content: string, iconType: 'info' | 'error') {
  tray?.displayBalloon({ title, content, iconType });
}

/** Même copie vérifiée que le serveur (`cli backup` : VACUUM INTO + integrity_check + rotation), caisse ouverte. */
async function backupNow() {
  if (backupRunning) return;
  if (!existsSync(files.database)) return notify('Sauvegarde impossible', 'Aucune base sur ce PC : créez d’abord le restaurant.', 'error');
  if (!install.nodeExe || !install.cli || !existsSync(install.nodeExe) || !existsSync(install.cli)) {
    return notify('Sauvegarde impossible', 'Outil de sauvegarde introuvable : réinstallez AfriKaisse.', 'error');
  }
  backupRunning = true;
  refreshTray();
  try {
    const env: Record<string, string | undefined> = { ...process.env, AFK_PROFILE: 'local', AFK_DB: `sqlite:${files.database}`, AFK_BACKUP_DIR: files.backups, AFK_LOG_LEVEL: 'silent', NODE_NO_WARNINGS: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await commun.run(install.nodeExe, [install.cli, 'backup'], { cwd: files.data, env, timeoutMs: BACKUP_TIMEOUT_MS });
    const file = result.code === 0 ? parseBackupOutput(result.output) : null;
    if (file) notify('Sauvegarde terminée', `${file.name} (${formatSize(file.size)}) dans ${files.backups}`, 'info');
    else notify('Sauvegarde impossible', errorSummary(result.output, result.timedOut), 'error');
  } finally {
    backupRunning = false;
    refreshTray();
  }
}

function prefsFile() {
  return join(app.getPath('userData'), 'preferences.json');
}

function readPrefs(): { loginItemSet?: boolean } {
  try {
    return JSON.parse(readFileSync(prefsFile(), 'utf8')) as { loginItemSet?: boolean };
  } catch {
    return {};
  }
}

function loginItemEnabled(): boolean {
  return app.getLoginItemSettings(LOGIN_ITEM).openAtLogin;
}

/** Entrée « Exécuter » de l'utilisateur Windows (HKCU) : la console seule, le serveur ne dépend pas d'elle. */
function setLoginItem(openAtLogin: boolean) {
  app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin });
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), loginItemSet: true }));
  } catch {
    /* préférence redemandée au prochain lancement */
  }
  refreshTray();
}

function statusLabel(): string {
  if (known) return `Serveur en marche · port ${known.port}`;
  return starting ? 'Serveur en démarrage…' : 'Serveur arrêté';
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`AfriKaisse — ${statusLabel()}`);
  const items: MenuItemConstructorOptions[] = [
    { label: statusLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Ouvrir la caisse', click: () => void openSection('caisse') },
    { label: 'État du système', click: () => void openSection('supervision') },
    { label: 'Appairer une tablette', click: () => openPairing() },
    { label: backupRunning ? 'Sauvegarde en cours…' : 'Sauvegarder maintenant', enabled: !backupRunning, click: () => void backupNow() },
    { type: 'separator' },
  ];
  if (app.isPackaged) items.push({ label: 'Démarrer avec Windows', type: 'checkbox', checked: loginItemEnabled(), click: (item) => setLoginItem(item.checked) });
  items.push({ label: 'Quitter la console', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ---------------------------------------------------------------------------------------------------
// Sécurité et démarrage
// ---------------------------------------------------------------------------------------------------

function trusted(event: IpcMainInvokeEvent): boolean {
  return isLocalWindowUrl(event.senderFrame?.url ?? '', WINDOWS_DIR);
}

function secure() {
  const allowedNavigation = (url: string) => isLocalWindowUrl(url, WINDOWS_DIR) || isAppUrl(url, known?.port ?? null);
  app.on('web-contents-created', (_event, contents) => {
    const guard = (event: { preventDefault: () => void }, url: string) => {
      if (allowedNavigation(url)) return;
      event.preventDefault();
      if (isExternalLink(url)) void shell.openExternal(url);
    };
    contents.on('will-navigate', (event, url) => guard(event, url));
    contents.on('will-redirect', (event, url) => guard(event, url));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalLink(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl, known?.port ?? null)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isAppUrl(origin, known?.port ?? null));

  ipcMain.handle('afk:attente', (event) => (trusted(event) ? waiting : null));
  ipcMain.handle('afk:appairage', (event) => (trusted(event) ? pairingInfo() : null));
  ipcMain.handle('afk:reessayer', (event) => {
    if (!trusted(event)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    const section = [...sectionWindows].find(([, w]) => w === win)?.[0];
    if (win && section) void loadSection(win, section);
  });
  ipcMain.handle('afk:journaux', (event) => {
    if (trusted(event)) void shell.openPath(files.logs);
  });
  ipcMain.handle('afk:fermer', (event) => {
    if (trusted(event)) BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

async function ready() {
  Menu.setApplicationMenu(null);
  secure();
  const image = nativeImage.createFromPath(ICON);
  tray = new Tray(image);
  tray.on('click', () => void openSection('caisse'));
  refreshTray();
  // Première fois sur ce compte Windows (console installée) : la console s'ouvre avec la session.
  if (app.isPackaged && !readPrefs().loginItemSet) setLoginItem(true);
  setInterval(() => void probe(), STATUS_EVERY_MS);
  if (HIDDEN_START) void ensureServer();
  else await openFromArguments(process.argv);
}

/** `--appairage` et `--etat` : raccourcis du menu Démarrer ; sans option, la caisse. */
function openFromArguments(argv: readonly string[]) {
  if (argv.includes('--appairage')) return openPairing();
  if (argv.includes('--etat')) return openSection('supervision');
  return openSection('caisse');
}

app.setName('AfriKaisse');
app.setPath('userData', join(app.getPath('appData'), 'AfriKaisse', 'Console'));
app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes('--cache')) void openFromArguments(argv);
  });
  // Toutes les fenêtres fermées : la console reste dans la zone de notification.
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(ready);
}
