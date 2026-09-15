'use strict';
/**
 * Lanceur d'AfriKaisse dans le navigateur (repli quand la console n'est pas installée ; Node embarqué).
 *
 * - AfriKaisse tourne déjà : on rouvre simplement l'application dans le navigateur.
 * - Tâche planifiée « AfriKaisse\Serveur » installée : on demande à Windows de la lancer et on attend
 *   le serveur. Le lanceur ne démarre JAMAIS un second serveur à côté de la tâche.
 * - Sinon (installation sans tâche, essais) : démarrage du serveur détaché, comme en phase 11.
 * - Écran de démarrage IMMÉDIAT (le clic doit produire quelque chose). On n'alerte que si le serveur
 *   s'est réellement arrêté, jamais pour une simple lenteur (leçon Scolaar).
 *
 * Options : --silencieux (démarrage avec Windows, sans navigateur), --sans-navigateur.
 * Surcharges pour les essais : AFK_HOME_DATA (dossier de données), AFK_PORT.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const c = require('./commun.cjs');

const APP = path.resolve(__dirname, '..');
const P = c.paths(c.dataDir());
const NO_BROWSER = process.argv.includes('--silencieux') || process.argv.includes('--sans-navigateur');
const PREFERRED = Number(process.env.AFK_PORT) || c.PREFERRED_PORT;
// L'écran de démarrage sonde les mêmes ports que le serveur.
const CANDIDATES = [...new Set([PREFERRED, ...c.CANDIDATE_PORTS])];
const FIRST_RUN_WAIT_MS = 180_000;
const WAIT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(target) {
  if (NO_BROWSER) return;
  spawn('cmd.exe', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}

function alertUser(message) {
  if (NO_BROWSER) return;
  spawn('mshta.exe', [`javascript:alert(${JSON.stringify(message)});close()`], { detached: true, stdio: 'ignore' }).unref();
}

function startupScreen(firstRun) {
  if (NO_BROWSER) return;
  const file = path.join(P.data, 'demarrage.html');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>AfriKaisse démarre…</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#f4f4f4;font:14px Roboto,'Segoe UI',Arial,sans-serif;color:#2d2d2d}
.box{width:420px;background:#fff;border-radius:4px;box-shadow:0 3px 12px rgba(0,0,0,.36);overflow:hidden}.bar{background:#065fd4;color:#fff;padding:10px 14px;font-weight:500}
.body{padding:18px 16px}.muted{color:#767676}.track{height:6px;background:#e5e5e5;margin:14px 0 6px;overflow:hidden}
.fill{height:6px;width:30%;background:#065fd4;animation:m 1.4s ease-in-out infinite}@keyframes m{0%{margin-left:-30%}100%{margin-left:100%}}</style></head>
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
  try {
    fs.writeFileSync(file, html);
    open(file);
  } catch {
    /* dossier de données en lecture seule pour ce compte : l'application s'ouvrira dès que le serveur répond */
  }
}

/** Attend le serveur ; ouvre le bon port si l'écran de démarrage ne peut pas le deviner (port attribué par Windows). */
async function waitForServer(deadline, hasExited) {
  let opened = false;
  while (Date.now() < deadline) {
    const exited = hasExited();
    if (exited !== null) return { exited };
    const info = c.readPortFile(P.portFile);
    if (info && (await c.healthy(info))) {
      console.log(`AfriKaisse prêt : http://localhost:${info.port}/`);
      if (!CANDIDATES.includes(info.port) && !opened) open(`http://localhost:${info.port}/`);
      opened = true;
      return { ready: true };
    }
    await sleep(500);
  }
  return { ready: false };
}

async function main() {
  const known = c.readPortFile(P.portFile);
  if (known && (await c.healthy(known))) {
    open(`http://localhost:${known.port}/`);
    console.log(`AfriKaisse fonctionne déjà sur le port ${known.port}.`);
    return;
  }

  const firstRun = !fs.existsSync(P.database);
  const deadline = Date.now() + (firstRun ? FIRST_RUN_WAIT_MS : WAIT_MS);

  if (await c.taskInstalled()) {
    startupScreen(firstRun);
    const started = await c.runTask();
    if (started.code !== 0) console.log(`Lancement de la tâche refusé (${started.output}) : Windows la relance seul toutes les 5 minutes.`);
    const result = await waitForServer(deadline, () => null);
    if (!result.ready) console.log('Le serveur démarre encore ; l’écran de démarrage ouvrira l’application.');
    return;
  }

  fs.mkdirSync(P.logs, { recursive: true });
  startupScreen(firstRun);
  try {
    fs.unlinkSync(P.portFile);
  } catch {
    /* pas encore de port retenu */
  }

  const log = fs.openSync(path.join(P.logs, 'serveur.log'), 'a');
  const server = spawn(process.execPath, [path.join(APP, 'app', 'server.cjs')], {
    cwd: P.data,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: c.serverEnv({ app: APP, data: P.data }),
  });
  fs.writeFileSync(P.serverPid, String(server.pid));
  let exited = null;
  server.on('exit', (code) => (exited = code ?? -1));
  server.unref();

  const result = await waitForServer(deadline, () => exited);
  if ('exited' in result) {
    alertUser(`AfriKaisse n'a pas pu démarrer.\n\nLe détail est dans :\n${path.join(P.logs, 'serveur.log')}`);
    console.error(`Le serveur s'est arrêté (code ${result.exited}).`);
    process.exitCode = 1;
    return;
  }
  // Lent mais vivant : on rend la main sans alerte, l'écran de démarrage finira par basculer.
  if (!result.ready) console.log('Le serveur démarre encore ; l’écran de démarrage ouvrira l’application.');
}

main().catch((err) => {
  console.error(err);
  alertUser(`AfriKaisse n'a pas pu démarrer : ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
