'use strict';
/**
 * Tâche planifiée « AfriKaisse\Serveur » : le serveur du restaurant démarre avec Windows, AVANT toute
 * ouverture de session, sous le compte « Service local » (droits minimaux), et se relance seul.
 *
 * Pourquoi une tâche planifiée plutôt qu'un service Windows (ADR-007, DESKTOP.md) : un service exige un
 * exécutable qui dialogue avec le gestionnaire de services. Node ne le fait pas seul, et l'enveloppe
 * habituelle (WinSW) serait un binaire tiers à télécharger et à tenir à jour. Le Planificateur de tâches
 * est dans Windows, s'enregistre en une commande et offre ce qu'il faut : démarrage au boot sans session,
 * compte de service, relance.
 *
 * Usage (installateur, administrateur) : node tache.cjs installer | desinstaller
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TASK_NAME, dataDir, paths, run, schtasks, stopProcesses, system32 } = require('./commun.cjs');

/** NT AUTHORITY\LOCAL SERVICE : identifiant indépendant de la langue de Windows. */
const LOCAL_SERVICE_SID = 'S-1-5-19';
/**
 * Administrateurs et système : contrôle total ; utilisateurs authentifiés : lire et lancer la tâche
 * (la console relance le serveur sans demander de mot de passe administrateur).
 */
const TASK_SDDL = 'D:(A;;FA;;;BA)(A;;FA;;;SY)(A;;GRGX;;;AU)';
const REPEAT_INTERVAL = 'PT5M';

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function requireWindowsPath(label, value) {
  if (typeof value !== 'string' || !path.win32.isAbsolute(value) || !/^[a-zA-Z]:\\/.test(value)) throw new Error(`${label} : chemin absolu Windows attendu (${value}).`);
  if (/["\r\n]/.test(value)) throw new Error(`${label} : caractère interdit dans le chemin (${value}).`);
  return value;
}

/**
 * XML de la tâche (schéma Task Scheduler 1.2, ordre des éléments identique à un export de Windows).
 * - Déclencheur au démarrage de Windows, répété toutes les 5 minutes : si le superviseur a disparu,
 *   Windows le relance ; s'il tourne, « IgnoreNew » ignore la répétition.
 * - Aucun délai d'exécution (PT0S), pas d'arrêt sur batterie ni en veille : c'est la caisse.
 * - Priorité normale (la valeur par défaut d'une tâche, 7, est « inférieure à la normale »).
 */
function buildTaskXml({ nodeExe, script, workingDir, securityDescriptor = TASK_SDDL }) {
  requireWindowsPath('Node embarqué', nodeExe);
  requireWindowsPath('Superviseur', script);
  requireWindowsPath('Dossier de travail', workingDir);
  const sd = securityDescriptor ? `\n    <SecurityDescriptor>${escapeXml(securityDescriptor)}</SecurityDescriptor>` : '';
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>GLOBALTECH BUSINESS TD</Author>
    <Description>Serveur AfriKaisse du restaurant : caisse, commandes, cuisine, impression et synchronisation, même sans session ouverte.</Description>${sd}
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Repetition>
        <Interval>${REPEAT_INTERVAL}</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${LOCAL_SERVICE_SID}</UserId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(nodeExe)}</Command>
      <Arguments>${escapeXml(`"${script}"`)}</Arguments>
      <WorkingDirectory>${escapeXml(workingDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** schtasks /XML attend de l'UTF-16 avec BOM (l'UTF-8 est refusé sur certaines éditions). */
function encodeTaskXml(xml) {
  return Buffer.from(`﻿${xml}`, 'utf16le');
}

async function createTask(xml) {
  const file = path.join(os.tmpdir(), `afrikaisse-tache-${process.pid}-${Date.now()}.xml`);
  fs.writeFileSync(file, encodeTaskXml(xml));
  try {
    return await schtasks(['/Create', '/TN', TASK_NAME, '/XML', file, '/F'], 60_000);
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* fichier temporaire */
    }
  }
}

async function main(command) {
  const app = path.resolve(__dirname, '..');
  const data = dataDir();
  const p = paths(data);
  fs.mkdirSync(p.logs, { recursive: true });
  const journal = (message) => fs.appendFileSync(path.join(p.logs, 'installation.log'), `${new Date().toISOString()} ${message}\n`);

  if (command === 'installer') {
    // Le Service local écrit la base, les journaux et les sauvegardes. Le dossier d'abord (obligatoire),
    // puis les fichiers existants (une base créée par une version précédente, lancée par l'utilisateur).
    const folder = await run(system32('icacls.exe'), [data, '/grant', `*${LOCAL_SERVICE_SID}:(OI)(CI)M`, '/C', '/Q'], { timeoutMs: 60_000 });
    if (folder.code !== 0) {
      journal(`Droits du Service local refusés sur ${data} (code ${folder.code}) : ${folder.output}`);
      return 1;
    }
    const files = await run(system32('icacls.exe'), [data, '/grant', `*${LOCAL_SERVICE_SID}:(OI)(CI)M`, '/T', '/C', '/Q'], { timeoutMs: 180_000 });
    if (files.code !== 0) journal(`Droits du Service local : certains fichiers n'ont pas été modifiés (code ${files.code}) : ${files.output}`);

    const options = { nodeExe: path.join(app, 'runtime', 'node', 'node.exe'), script: path.join(app, 'lanceur', 'service.cjs'), workingDir: data };
    let created = await createTask(buildTaskXml(options));
    if (created.code !== 0) {
      // Descripteur de sécurité refusé : la tâche reste utile, seule la relance depuis la console par un non-administrateur est perdue.
      journal(`Tâche avec droits de lancement refusée (code ${created.code}) : ${created.output}. Nouvel essai sans.`);
      created = await createTask(buildTaskXml({ ...options, securityDescriptor: null }));
    }
    if (created.code !== 0) {
      journal(`Tâche planifiée refusée (code ${created.code}) : ${created.output}`);
      return 1;
    }
    const started = await schtasks(['/Run', '/TN', TASK_NAME]);
    journal(`Tâche ${TASK_NAME} enregistrée (Service local) ; lancement : code ${started.code}.`);
    return 0;
  }

  if (command === 'desinstaller') {
    await schtasks(['/End', '/TN', TASK_NAME]);
    const removed = await schtasks(['/Delete', '/TN', TASK_NAME, '/F']);
    await stopProcesses(p);
    journal(`Tâche ${TASK_NAME} supprimée (code ${removed.code}). Les données sont conservées.`);
    return 0;
  }

  console.error('Usage : node tache.cjs installer | desinstaller');
  return 2;
}

if (require.main === module) {
  main(process.argv[2]).then(
    (code) => (process.exitCode = code),
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}

module.exports = { LOCAL_SERVICE_SID, TASK_SDDL, escapeXml, buildTaskXml, encodeTaskXml };
