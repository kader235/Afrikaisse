'use strict';
/**
 * Superviseur du serveur AfriKaisse : action de la tâche planifiée « AfriKaisse\Serveur » (tache.cjs),
 * sous le compte Service local, sans fenêtre ni session ouverte.
 *
 * - Démarre `app/server.cjs` avec l'environnement du lanceur (port choisi par le serveur, fichier de
 *   port, sauvegardes, journaux) et le relance s'il s'arrête : 1 s, 2 s, 5 s, 10 s, 30 s, puis chaque minute.
 * - Relance aussi un serveur qui ne répond plus à /api/health depuis 3 minutes (jamais pendant le
 *   premier démarrage : le contrôle attend le fichier de port, écrit après les migrations).
 * - Un serveur AfriKaisse répond déjà (lancé par une ancienne version ou par la console) : il est
 *   surveillé, jamais doublé. Deux serveurs sur la même base imprimeraient deux fois.
 * - Un seul superviseur à la fois (superviseur.pid) ; Windows relance la tâche toutes les 5 minutes
 *   si le superviseur lui-même a disparu.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const c = require('./commun.cjs');

const APP = path.resolve(__dirname, '..');
const P = c.paths(c.dataDir());
const HEALTH_EVERY_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_FAILURES_BEFORE_RESTART = 6;
const LOG = path.join(P.logs, 'superviseur.log');

let child = null;
let stopping = false;
let crashes = 0;
let startedAt = 0;
let failures = 0;

function log(message) {
  try {
    fs.mkdirSync(P.logs, { recursive: true });
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1_000_000) fs.renameSync(LOG, LOG.replace(/\.log$/, '.1.log'));
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* journal indisponible : le serveur passe avant */
  }
}

function scheduleStart(delay) {
  if (!stopping) setTimeout(() => void start(), delay);
}

async function start() {
  if (stopping || child) return;
  const known = c.readPortFile(P.portFile);
  if (known && (await c.healthy(known, HEALTH_TIMEOUT_MS))) {
    // Pas le nôtre : on le laisse travailler et on reprend la main s'il s'arrête.
    return scheduleStart(HEALTH_EVERY_MS);
  }
  try {
    fs.unlinkSync(P.portFile);
  } catch {
    /* pas encore de port retenu */
  }

  let out;
  try {
    out = fs.openSync(path.join(P.logs, 'serveur.log'), 'a');
  } catch (err) {
    log(`Journal du serveur inaccessible (${err.message}) : droits du Service local sur ${P.data} ?`);
    return scheduleStart(60_000);
  }
  startedAt = Date.now();
  failures = 0;
  const server = spawn(process.execPath, [path.join(APP, 'app', 'server.cjs')], {
    cwd: P.data,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: c.serverEnv({ app: APP, data: P.data }),
  });
  fs.closeSync(out);
  child = server;

  server.on('error', (err) => {
    log(`Démarrage du serveur impossible : ${err.message}`);
    if (child === server) {
      child = null;
      crashes += 1;
      scheduleStart(c.restartDelay(crashes));
    }
  });
  if (!server.pid) return;
  fs.writeFileSync(P.serverPid, String(server.pid));
  log(`Serveur démarré (processus ${server.pid}).`);

  server.on('exit', (code, signal) => {
    if (child !== server) return;
    child = null;
    if (stopping) return;
    const uptime = Date.now() - startedAt;
    crashes = uptime >= c.STABLE_UPTIME_MS ? 1 : crashes + 1;
    const delay = c.restartDelay(crashes);
    log(`Serveur arrêté (${signal ?? `code ${code}`}) après ${Math.round(uptime / 1000)} s : redémarrage dans ${delay / 1000} s. Détail : journaux\\serveur.log`);
    scheduleStart(delay);
  });
}

async function watch() {
  if (!child || stopping) return;
  const info = c.readPortFile(P.portFile);
  if (!info) return; // premier démarrage, migrations : le serveur n'écoute pas encore
  if (await c.healthy(info, HEALTH_TIMEOUT_MS)) {
    failures = 0;
    return;
  }
  failures += 1;
  if (failures >= HEALTH_FAILURES_BEFORE_RESTART && child) {
    log(`Le serveur ne répond plus depuis ${(failures * HEALTH_EVERY_MS) / 60_000} minutes : arrêt forcé puis redémarrage.`);
    failures = 0;
    child.kill();
  }
}

function stop() {
  stopping = true;
  log('Arrêt du superviseur demandé.');
  if (child) child.kill();
  setTimeout(() => process.exit(0), 2_000).unref();
}

async function main() {
  fs.mkdirSync(P.logs, { recursive: true });
  const other = c.readPid(P.supervisorPid);
  if (other && other !== process.pid && (await c.isNodeProcess(other, false))) {
    log(`Superviseur déjà actif (processus ${other}) : rien à faire.`);
    return;
  }
  fs.writeFileSync(P.supervisorPid, String(process.pid));
  process.on('exit', () => {
    if (c.readPid(P.supervisorPid) === process.pid) {
      try {
        fs.unlinkSync(P.supervisorPid);
      } catch {
        /* déjà absent */
      }
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, stop);
  log(`Superviseur démarré (processus ${process.pid}, compte ${process.env.USERNAME || 'inconnu'}).`);
  setInterval(() => void watch(), HEALTH_EVERY_MS);
  await start();
}

main().catch((err) => {
  log(`Superviseur arrêté sur une erreur : ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
});
