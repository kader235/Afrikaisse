'use strict';
/**
 * Socle commun du lanceur, du superviseur (tâche planifiée), de l'arrêt, de l'enregistrement de la
 * tâche et de la console Electron : emplacements, fichier de port, santé du serveur, tâche planifiée,
 * processus. Node embarqué, aucune dépendance. Fonctions pures testées dans infrastructure/windows/test.
 *
 * Aucun appel de programme sans délai : un outil Windows qui pend ne doit jamais figer le lanceur,
 * l'installateur ou la console.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

/** Tâche planifiée qui porte le serveur (dossier « AfriKaisse » du Planificateur de tâches). */
const TASK_NAME = 'AfriKaisse\\Serveur';
const PREFERRED_PORT = 7300;
/** Mêmes candidats que le serveur (services/api/src/main.ts → listenLocal). */
const CANDIDATE_PORTS = [7300, 8300, 9300, 7400, 8800, 3000, 18300, 28300];
/** Redémarrages successifs rapprochés : 1 s, 2 s, 5 s, 10 s, 30 s, puis une fois par minute. */
const RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
/** Au-delà de 10 minutes de fonctionnement, un arrêt n'est plus compté comme une série de plantages. */
const STABLE_UPTIME_MS = 10 * 60_000;

function dataDir(env = process.env) {
  return env.AFK_HOME_DATA || path.join(env.ProgramData || 'C:\\ProgramData', 'AfriKaisse');
}

function paths(data) {
  return {
    data,
    database: path.join(data, 'afrikaisse.sqlite'),
    portFile: path.join(data, 'port.txt'),
    serverPid: path.join(data, 'serveur.pid'),
    supervisorPid: path.join(data, 'superviseur.pid'),
    logs: path.join(data, 'journaux'),
    backups: path.join(data, 'sauvegardes'),
  };
}

/** `{ port, nodeId }` écrit par le serveur une fois à l'écoute ; null si illisible ou incomplet. */
function parsePortFile(text) {
  let info;
  try {
    info = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!info || typeof info !== 'object') return null;
  if (!Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) return null;
  if (typeof info.nodeId !== 'string' || !info.nodeId) return null;
  return { port: info.port, nodeId: info.nodeId };
}

function readPortFile(file) {
  try {
    return parsePortFile(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readPid(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Vrai seulement si c'est CE serveur local qui répond (un autre logiciel peut occuper le port). */
function isOwnHealth(health, nodeId) {
  return !!health && health.status === 'ok' && health.profile === 'local' && typeof nodeId === 'string' && health.nodeId === nodeId;
}

/** Réponse de `/api/health` sur 127.0.0.1, ou null (refus, délai, autre chose que du JSON). */
function fetchHealth(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 256_000) req.destroy();
      });
      res.on('error', () => resolve(null));
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function healthy(info, timeoutMs = 1500) {
  return !!info && isOwnHealth(await fetchHealth(info.port, timeoutMs), info.nodeId);
}

/** Environnement du serveur local : le même pour le lanceur et pour le superviseur. */
function serverEnv({ app, data, env = process.env }) {
  const p = paths(data);
  return {
    ...env,
    AFK_PROFILE: 'local',
    AFK_DB: `sqlite:${p.database}`,
    AFK_PORT: String(Number(env.AFK_PORT) || PREFERRED_PORT),
    AFK_WEB_DIR: path.join(app, 'app', 'web'),
    AFK_PORT_FILE: p.portFile,
    AFK_BACKUP_DIR: p.backups,
    // Un journal par catégorie (application, security, sync, printer, database, system), à rotation.
    AFK_LOG_DIR: p.logs,
    AFK_LOG_LEVEL: env.AFK_LOG_LEVEL || 'warn',
    NODE_NO_WARNINGS: '1',
  };
}

function restartDelay(crashesInRow) {
  const index = Math.min(Math.max(Math.trunc(crashesInRow) || 1, 1), RESTART_DELAYS_MS.length) - 1;
  return RESTART_DELAYS_MS[index];
}

/** Lance un programme et rend { code, output, timedOut } ; arrêt forcé au bout du délai. */
function run(command, args, { timeoutMs = 15_000, cwd, env } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output: output.trim(), timedOut });
    };
    let child;
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      output = String(err && err.message ? err.message : err);
      return resolve({ code: -1, output, timedOut });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (err) => {
      output += String(err.message);
      done(-1);
    });
    child.on('close', (code) => done(code ?? -1));
  });
}

const system32 = (name) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);

function schtasks(args, timeoutMs = 20_000) {
  return run(system32('schtasks.exe'), args, { timeoutMs });
}

async function taskInstalled() {
  if (process.platform !== 'win32') return false;
  return (await schtasks(['/Query', '/TN', TASK_NAME])).code === 0;
}

/** Demande à Windows de lancer la tâche ; un compte sans droit peut être refusé (elle repasse seule). */
function runTask() {
  return schtasks(['/Run', '/TN', TASK_NAME]);
}

/** Processus présent ? EPERM : il existe, mais appartient à un autre compte (Service local). */
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Nom d'image dans la sortie `tasklist /FO CSV /NH` (« "node.exe","1234",… »), null si aucun processus. */
function parseTasklistImage(output) {
  const line = String(output)
    .split(/\r?\n/)
    .find((l) => l.startsWith('"'));
  const match = line ? /^"([^"]+)"/.exec(line) : null;
  return match ? match[1] : null;
}

/** { ok, image } : ok faux si tasklist n'a pas pu répondre (on ne sait alors rien du processus). */
async function processImage(pid) {
  const result = await run(system32('tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeoutMs: 10_000 });
  return { ok: result.code === 0, image: result.code === 0 ? parseTasklistImage(result.output) : null };
}

/**
 * Un numéro de processus mémorisé est-il encore un Node d'AfriKaisse ? Windows réutilise les numéros :
 * un ancien fichier .pid peut désigner un autre programme. Inconnu (tasklist muet) : `whenUnknown`.
 */
async function isNodeProcess(pid, whenUnknown) {
  if (!isAlive(pid)) return false;
  const { ok, image } = await processImage(pid);
  if (!ok) return whenUnknown;
  return !!image && image.toLowerCase() === 'node.exe';
}

/** Arrête le superviseur puis le serveur (arbre de processus), et efface les fichiers d'état. */
async function stopProcesses(p) {
  for (const file of [p.supervisorPid, p.serverPid]) {
    const pid = readPid(file);
    if (pid && (await isNodeProcess(pid, true))) {
      await run(system32('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { timeoutMs: 15_000 });
    }
  }
  for (const file of [p.supervisorPid, p.serverPid, p.portFile]) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* déjà absent */
    }
  }
}

module.exports = {
  TASK_NAME,
  PREFERRED_PORT,
  CANDIDATE_PORTS,
  RESTART_DELAYS_MS,
  STABLE_UPTIME_MS,
  dataDir,
  paths,
  parsePortFile,
  readPortFile,
  readPid,
  isOwnHealth,
  fetchHealth,
  healthy,
  serverEnv,
  restartDelay,
  run,
  system32,
  schtasks,
  taskInstalled,
  runTask,
  isAlive,
  parseTasklistImage,
  processImage,
  isNodeProcess,
  stopProcesses,
};
