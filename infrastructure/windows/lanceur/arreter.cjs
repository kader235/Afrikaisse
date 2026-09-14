'use strict';
/** Arrête le serveur AfriKaisse (mise à jour, désinstallation). Les données ne sont jamais touchées. */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DATA = process.env.AFK_HOME_DATA || path.join(process.env.ProgramData || 'C:\\ProgramData', 'AfriKaisse');
const PID_FILE = path.join(DATA, 'serveur.pid');

let pid = null;
try {
  pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim()) || null;
} catch {
  /* jamais démarré */
}

if (pid) {
  // Délai et arrêt forcé : un outil qui pend ne doit jamais figer une mise à jour.
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 15_000, killSignal: 'SIGKILL' });
  console.log(`Serveur AfriKaisse arrêté (processus ${pid}).`);
}
for (const file of [PID_FILE, path.join(DATA, 'port.txt')]) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* déjà absent */
  }
}
