/**
 * Construit le serveur AfriKaisse pour Windows :
 *   charge/  (ce que l'installateur copie dans Program Files)
 *   sortie/AfriKaisse-Setup-<version>.exe
 *
 * Usage : node infrastructure/windows/build.mjs [--sans-installateur]
 * Variables : AFK_NODE_EXE (node.exe 24 win-x64 à embarquer), ISCC (compilateur Inno Setup 6).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '../..');
const CHARGE = join(HERE, 'charge');
const NODE_EXE = process.env.AFK_NODE_EXE ?? 'C:/PROJETS/notexpress/installateur/charge/runtime/node/node.exe';
const ISCC = process.env.ISCC ?? 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe';
const withInstaller = !process.argv.includes('--sans-installateur');

function run(command, args, cwd = ROOT) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npm' });
  if (result.status !== 0) throw new Error(`Échec : ${command} ${args.join(' ')} (code ${result.status})`);
}

function copy(from, to) {
  if (!existsSync(from)) throw new Error(`Fichier absent : ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

const version = /API_VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'services/api/src/app.ts'), 'utf8'))?.[1] ?? '0.0.0';

// 1. Serveur en un fichier et application web.
run('npm', ['run', 'build:api']);
run('npm', ['run', 'build:web']);

// 2. Node embarqué : même version majeure que le développement (node:sqlite).
if (!existsSync(NODE_EXE)) throw new Error(`node.exe à embarquer introuvable : ${NODE_EXE} (variable AFK_NODE_EXE)`);
const nodeVersion = spawnSync(NODE_EXE, ['--version'], { encoding: 'utf8' }).stdout.trim();
if (!/^v24\./.test(nodeVersion)) throw new Error(`Node 24 requis pour l'embarqué, trouvé ${nodeVersion}`);

// 3. Charge.
rmSync(CHARGE, { recursive: true, force: true });
copy(join(ROOT, 'services/api/dist/server.cjs'), join(CHARGE, 'app/server.cjs'));
copy(join(ROOT, 'services/api/dist/cli.cjs'), join(CHARGE, 'app/cli.cjs'));
copy(join(ROOT, 'apps/web/dist'), join(CHARGE, 'app/web'));
mkdirSync(join(CHARGE, 'runtime/node'), { recursive: true });
copyFileSync(NODE_EXE, join(CHARGE, 'runtime/node/node.exe'));
copy(join(HERE, 'lanceur'), join(CHARGE, 'lanceur'));
copy(join(HERE, 'scripts'), join(CHARGE, 'scripts'));
copy(join(HERE, 'AfriKaisse.vbs'), join(CHARGE, 'AfriKaisse.vbs'));
copy(join(HERE, 'Arreter AfriKaisse.vbs'), join(CHARGE, 'Arreter AfriKaisse.vbs'));
run('python', [join(HERE, 'dessiner-icone.py'), join(CHARGE, 'afrikaisse.ico')], HERE);
console.log(`\nCharge prête : ${CHARGE} (Node ${nodeVersion}, AfriKaisse ${version})`);

// 4. Installateur.
if (withInstaller) {
  if (!existsSync(ISCC)) throw new Error(`Inno Setup 6 introuvable : ${ISCC} (variable ISCC)`);
  run(ISCC, [`/DAppVersion=${version}`, 'AfriKaisse.iss'], HERE);
  const setup = join(HERE, 'sortie', `AfriKaisse-Setup-${version}.exe`);
  console.log(`\nInstallateur : ${setup} (${(statSync(setup).size / 1e6).toFixed(1)} Mo)`);
}
