import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Paquet de mise en ligne sur o2switch : `node infrastructure/o2switch/build.mjs`.
 * Produit sortie/afrikaisse.tar.gz (serveur et écrans), DEPOSER-AFRIKAISSE.sh et LISEZ-MOI.txt,
 * et en dépose une copie sur le Bureau. Rien à installer sur l'hébergement : pas de npm install.
 */
const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, '../..');
const sortie = join(ici, 'sortie');
const charge = join(sortie, 'charge');

const run = (cmd, env = {}) => execSync(cmd, { cwd: racine, stdio: 'inherit', env: { ...process.env, ...env } });
// Les scripts partent sur Linux : fins de ligne Unix, même si Git les a extraits en CRLF.
const lf = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const { version } = JSON.parse(readFileSync(join(racine, 'services/api/package.json'), 'utf8'));
const commit = execSync('git rev-parse --short HEAD', { cwd: racine }).toString().trim();
const modifie = execSync('git status --porcelain', { cwd: racine }).toString().trim() ? '-modifie' : '';
const quand = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const build = `${version}-${commit}${modifie}-${quand}`;

run('npm run build:api', { AFK_BUILD: build });
run('npm run build:web');

rmSync(sortie, { recursive: true, force: true });
mkdirSync(charge, { recursive: true });
for (const f of ['server.cjs', 'cli.cjs']) cpSync(join(racine, 'services/api/dist', f), join(charge, f));
cpSync(join(racine, 'apps/web/dist'), join(charge, 'web'), { recursive: true });
writeFileSync(join(charge, 'sauvegarder.sh'), lf(join(ici, 'sauvegarder.sh')));
writeFileSync(join(charge, 'VERSION'), `${build}\n`);

// Chemins relatifs, sans dossier parent : l'archive s'extrait directement dans ~/afrikaisse.
execSync('tar -czf afrikaisse.tar.gz -C charge .', { cwd: sortie, stdio: 'inherit' });
rmSync(charge, { recursive: true, force: true });
writeFileSync(join(sortie, 'DEPOSER-AFRIKAISSE.sh'), lf(join(ici, 'DEPOSER-AFRIKAISSE.sh')));
writeFileSync(join(sortie, 'LISEZ-MOI.txt'), lf(join(ici, 'LISEZ-MOI.txt')).replace(/\n/g, '\r\n'));

const bureau = join(homedir(), 'Desktop');
let copie = null;
if (existsSync(bureau)) {
  copie = join(bureau, 'AfriKaisse-o2switch');
  rmSync(copie, { recursive: true, force: true });
  cpSync(sortie, copie, { recursive: true });
}

const taille = (statSync(join(sortie, 'afrikaisse.tar.gz')).size / 1048576).toFixed(1).replace('.', ',');
console.log(`\nVersion ${build}`);
console.log(`Paquet : ${join(sortie, 'afrikaisse.tar.gz')} (${taille} Mo)`);
if (copie) console.log(`Copie sur le Bureau : ${copie}`);
