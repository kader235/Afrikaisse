'use strict';
/**
 * Arrête le serveur AfriKaisse (mise à jour, désinstallation). Les données ne sont jamais touchées.
 *
 * Tâche planifiée présente : elle est d'abord DÉSACTIVÉE, sinon sa répétition (toutes les 5 minutes)
 * relancerait le serveur pendant la copie des fichiers. L'installateur la recrée active ; une mise à
 * jour annulée la réactive (AfriKaisse.iss, DeinitializeSetup).
 * Délais et arrêt forcé partout (commun.cjs → run) : un outil qui pend ne doit jamais figer une mise à jour.
 */
const c = require('./commun.cjs');

async function main() {
  const p = c.paths(c.dataDir());
  if (await c.taskInstalled()) {
    await c.schtasks(['/Change', '/TN', c.TASK_NAME, '/DISABLE']);
    await c.schtasks(['/End', '/TN', c.TASK_NAME]);
  }
  await c.stopProcesses(p);
  console.log('Serveur AfriKaisse arrêté.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
