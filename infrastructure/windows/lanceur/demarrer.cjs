'use strict';
/**
 * Lanceur d'AfriKaisse sur le PC du restaurant (Node embarqué, aucune dépendance).
 *
 * - AfriKaisse tourne déjà : on rouvre simplement l'application dans le navigateur.
 * - Sinon : écran de démarrage IMMÉDIAT (le clic doit produire quelque chose), démarrage du
 *   serveur détaché, attente du port réellement retenu, puis ouverture de l'application.
 * - On n'alerte que si le serveur s'est réellement arrêté, jamais pour une simple lenteur
 *   (leçon Scolaar : une fausse alerte au premier lancement fait douter le client).
 *
 * Options : --silencieux (démarrage avec Windows, sans navigateur), --sans-navigateur.
 * Surcharges pour les essais : AFK_HOME_DATA (dossier de données), AFK_PORT.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const DATA = process.env.AFK_HOME_DATA || path.join(process.env.ProgramData || 'C:\\ProgramData', 'AfriKaisse');
const NO_BROWSER = process.argv.includes('--silencieux') || process.argv.includes('--sans-navigateur');
const PORT_FILE = path.join(DATA, 'port.txt');
const PID_FILE = path.join(DATA, 'serveur.pid');
const LOGS = path.join(DATA, 'journaux');
const PREFERRED = Number(process.env.AFK_PORT) || 7300;
// Mêmes candidats que le serveur (services/api/src/main.ts) : l'écran de démarrage les sonde.
const CANDIDATES = [...new Set([PREFERRED, 7300, 8300, 9300, 7400, 8800, 3000, 18300, 28300])];
const FIRST_RUN_WAIT_MS = 180_000;
const WAIT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** { port, nodeId } écrit par le serveur une fois à l'écoute. */
function readPort() {
  try {
    const info = JSON.parse(fs.readFileSync(PORT_FILE, 'utf8'));
    return Number.isInteger(info.port) && info.port > 0 ? info : null;
  } catch {
    return null;
  }
}

/** Vrai seulement si c'est CE serveur local qui répond (un autre logiciel peut occuper le port). */
function healthy(info) {
  const { port, nodeId } = info;
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const health = JSON.parse(body);
          resolve(res.statusCode === 200 && health.status === 'ok' && health.profile === 'local' && health.nodeId === nodeId);
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function open(target) {
  if (NO_BROWSER) return;
  spawn('cmd.exe', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}

function alertUser(message) {
  if (NO_BROWSER) return;
  spawn('mshta.exe', [`javascript:alert(${JSON.stringify(message)});close()`], { detached: true, stdio: 'ignore' }).unref();
}

function startupScreen(firstRun) {
  const file = path.join(DATA, 'demarrage.html');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>AfriKaisse démarre…</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#e7eaee;font:15px 'Segoe UI',Arial,sans-serif;color:#1c232b}
.box{width:420px;background:#fff;border:1px solid #c5cbd3}.bar{background:#1d4d82;color:#fff;padding:10px 14px;font-weight:600}
.body{padding:18px 16px}.muted{color:#6b7581}.track{height:6px;background:#e1e5ea;margin:14px 0 6px;overflow:hidden}
.fill{height:6px;width:30%;background:#1f5fa8;animation:m 1.4s ease-in-out infinite}@keyframes m{0%{margin-left:-30%}100%{margin-left:100%}}</style></head>
<body><div class="box"><div class="bar">AfriKaisse</div><div class="body">
<strong>${firstRun ? 'Première installation : préparation de la base…' : 'Démarrage du serveur du restaurant…'}</strong>
<div class="track"><div class="fill"></div></div>
<p class="muted" id="msg">${firstRun ? 'Cela peut prendre une minute. La fenêtre s’ouvrira seule.' : 'Quelques secondes. La fenêtre s’ouvrira seule.'}</p></div></div>
<script>
var ports=${JSON.stringify(CANDIDATES)},start=Date.now();
function probe(){ports.forEach(function(p){var i=new Image();i.onload=function(){location.replace('http://localhost:'+p+'/');};i.src='http://127.0.0.1:'+p+'/afk-ping.svg?t='+Date.now();});
if(Date.now()-start>${firstRun ? 150_000 : 90_000}){document.getElementById('msg').textContent='C’est plus long que prévu. Si rien ne s’ouvre, relancez AfriKaisse depuis son icône.';}}
setInterval(probe,1000);probe();
</script></body></html>`;
  fs.writeFileSync(file, html);
  open(file);
}

async function main() {
  fs.mkdirSync(LOGS, { recursive: true });

  const known = readPort();
  if (known && (await healthy(known))) {
    open(`http://localhost:${known.port}/`);
    console.log(`AfriKaisse fonctionne déjà sur le port ${known.port}.`);
    return;
  }

  const firstRun = !fs.existsSync(path.join(DATA, 'afrikaisse.sqlite'));
  startupScreen(firstRun);
  try {
    fs.unlinkSync(PORT_FILE);
  } catch {
    /* pas encore de port retenu */
  }

  const log = fs.openSync(path.join(LOGS, 'serveur.log'), 'a');
  const server = spawn(process.execPath, [path.join(APP, 'app', 'server.cjs')], {
    cwd: DATA,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      AFK_PROFILE: 'local',
      AFK_DB: `sqlite:${path.join(DATA, 'afrikaisse.sqlite')}`,
      AFK_PORT: String(PREFERRED),
      AFK_WEB_DIR: path.join(APP, 'app', 'web'),
      AFK_PORT_FILE: PORT_FILE,
      AFK_BACKUP_DIR: path.join(DATA, 'sauvegardes'),
      // Un journal par catégorie (application, security, sync, printer, database, system), à rotation.
      AFK_LOG_DIR: LOGS,
      AFK_LOG_LEVEL: process.env.AFK_LOG_LEVEL || 'warn',
      NODE_NO_WARNINGS: '1',
    },
  });
  fs.writeFileSync(PID_FILE, String(server.pid));
  let exited = null;
  server.on('exit', (code) => (exited = code ?? -1));
  server.unref();

  const deadline = Date.now() + (firstRun ? FIRST_RUN_WAIT_MS : WAIT_MS);
  while (Date.now() < deadline) {
    if (exited !== null) {
      alertUser(`AfriKaisse n'a pas pu démarrer.\n\nLe détail est dans :\n${path.join(LOGS, 'serveur.log')}`);
      console.error(`Le serveur s'est arrêté (code ${exited}).`);
      process.exitCode = 1;
      return;
    }
    const info = readPort();
    if (info && (await healthy(info))) {
      console.log(`AfriKaisse prêt : http://localhost:${info.port}/`);
      // Port attribué par Windows : l'écran de démarrage ne peut pas le deviner, on ouvre nous-mêmes.
      if (!CANDIDATES.includes(info.port)) open(`http://localhost:${info.port}/`);
      return; // l'écran de démarrage bascule seul sur l'application
    }
    await sleep(500);
  }
  // Lent mais vivant : on rend la main sans alerte, l'écran de démarrage finira par basculer.
  console.log('Le serveur démarre encore ; l’écran de démarrage ouvrira l’application.');
}

main().catch((err) => {
  console.error(err);
  alertUser(`AfriKaisse n'a pas pu démarrer : ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
