/**
 * Construit AfriKaisse pour Windows :
 *   charge/  (ce que l'installateur copie dans Program Files)
 *   sortie/AfriKaisse-Setup-<version>.exe
 *
 * Usage : node infrastructure/windows/build.mjs [--sans-installateur] [--console]
 *   --console  empaquette d'abord la console Electron (apps/desktop). Sans l'option, la console est
 *              reprise si apps/desktop/sortie/console existe déjà ; sinon l'installateur se construit
 *              sans elle (icône « AfriKaisse » vers le navigateur, comme en phase 11).
 * Variables : AFK_NODE_EXE (node.exe 24 win-x64 à embarquer), ISCC (compilateur Inno Setup 6),
 *             PYTHON (Python avec Pillow pour l'icône, si `python` n'est pas le bon dans le PATH).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '../..');
const CHARGE = join(HERE, 'charge');
const CONSOLE = join(ROOT, 'apps/desktop/sortie/console');
const NODE_EXE = process.env.AFK_NODE_EXE ?? 'C:/PROJETS/notexpress/installateur/charge/runtime/node/node.exe';
const ISCC = process.env.ISCC ?? 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe';
const withInstaller = !process.argv.includes('--sans-installateur');
const buildConsole = process.argv.includes('--console');

// Délai et arrêt forcé : un outil qui pend ne doit pas figer la construction.
function run(command, args, cwd = ROOT) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm', timeout: 20 * 60_000, killSignal: 'SIGKILL' });
  if (result.status !== 0) throw new Error(`Échec : ${command} ${args.join(' ')} (code ${result.status}${result.error ? `, ${result.error.message}` : ''})`);
}

function copy(from, to, filter) {
  if (!existsSync(from)) throw new Error(`Fichier absent : ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, filter });
}

const version = /API_VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'services/api/src/app.ts'), 'utf8'))?.[1] ?? '0.0.0';

// 1. Serveur en un fichier, application web, console.
run('npm', ['run', 'build:api']);
run('npm', ['run', 'build:web']);
if (buildConsole) run('npm', ['run', 'package', '-w', '@afrikaisse/desktop']);

// 2. Node embarqué : même version majeure que le développement (node:sqlite).
if (!existsSync(NODE_EXE)) throw new Error(`node.exe à embarquer introuvable : ${NODE_EXE} (variable AFK_NODE_EXE)`);
const nodeVersion = spawnSync(NODE_EXE, ['--version'], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' }).stdout?.trim() ?? '';
if (!/^v24\./.test(nodeVersion)) throw new Error(`Node 24 requis pour l'embarqué, trouvé ${nodeVersion || 'rien'}`);

// 3. Charge.
rmSync(CHARGE, { recursive: true, force: true });
copy(join(ROOT, 'services/api/dist/server.cjs'), join(CHARGE, 'app/server.cjs'));
copy(join(ROOT, 'services/api/dist/cli.cjs'), join(CHARGE, 'app/cli.cjs'));
copy(join(ROOT, 'apps/web/dist'), join(CHARGE, 'app/web'));
mkdirSync(join(CHARGE, 'runtime/node'), { recursive: true });
copyFileSync(NODE_EXE, join(CHARGE, 'runtime/node/node.exe'));
// Lanceur, superviseur, tâche planifiée ; les déclarations de types ne servent qu'aux tests.
copy(join(HERE, 'lanceur'), join(CHARGE, 'lanceur'), (src) => !src.endsWith('.d.cts'));
copy(join(HERE, 'scripts'), join(CHARGE, 'scripts'));
copy(join(HERE, 'AfriKaisse.vbs'), join(CHARGE, 'AfriKaisse.vbs'));
copy(join(HERE, 'Arreter AfriKaisse.vbs'), join(CHARGE, 'Arreter AfriKaisse.vbs'));
run(process.env.PYTHON ?? 'python', [join(HERE, 'dessiner-icone.py'), join(CHARGE, 'afrikaisse.ico')], HERE);
const withConsole = existsSync(join(CONSOLE, 'AfriKaisse.exe'));
if (withConsole) copy(CONSOLE, join(CHARGE, 'console'));
console.log(`\nCharge prête : ${CHARGE} (Node ${nodeVersion}, AfriKaisse ${version}, ${withConsole ? 'avec' : 'SANS'} la console)`);

// 4. Installateur (AfriKaisse.iss détecte charge\console\AfriKaisse.exe).
if (withInstaller) {
  if (!existsSync(ISCC)) throw new Error(`Inno Setup 6 introuvable : ${ISCC} (variable ISCC)`);
  run(ISCC, [`/DAppVersion=${version}`, 'AfriKaisse.iss'], HERE);
  const setup = join(HERE, 'sortie', `AfriKaisse-Setup-${version}.exe`);
  console.log(`\nInstallateur : ${setup} (${(statSync(setup).size / 1e6).toFixed(1)} Mo)`);
}
