/**
 * Empaquette la console sans electron-builder : Electron (licence MIT) copié tel quel, application dans
 * resources/app, exécutable renommé AfriKaisse.exe. Aucune signature de code (DESKTOP.md).
 *
 *   npm run package -w @afrikaisse/desktop
 *   → apps/desktop/sortie/console/AfriKaisse.exe (repris par infrastructure/windows/build.mjs)
 *
 * Premier empaquetage : Electron est téléchargé une fois (~110 Mo, réseau requis ; ELECTRON_MIRROR pour un miroir).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const HERE = resolve(import.meta.dirname, '..');
const ROOT = resolve(HERE, '../..');
const OUT = join(HERE, 'sortie', 'console');
const require = createRequire(import.meta.url);
// Langues de Chromium gardées : celles d'AfriKaisse. Les autres pèsent une quarantaine de Mo.
const LOCALES = new Set(['fr.pak', 'en-US.pak', 'ar.pak']);

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, timeout: 15 * 60_000, killSignal: 'SIGKILL' });
  if (result.status !== 0) throw new Error(`Échec : ${command} ${args.join(' ')} (code ${result.status}${result.error ? `, ${result.error.message}` : ''})`);
}

function size(path) {
  const s = statSync(path);
  return s.isDirectory() ? readdirSync(path).reduce((total, name) => total + size(join(path, name)), 0) : s.size;
}

run(process.execPath, [join(HERE, 'build.mjs')]);

const electronPkg = dirname(require.resolve('electron/package.json'));
const electronDist = join(electronPkg, 'dist');
if (!existsSync(join(electronDist, 'electron.exe'))) {
  console.log('Téléchargement d’Electron (une seule fois)…');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  run(process.execPath, [join(electronPkg, 'install.js')], env);
}
if (!existsSync(join(electronDist, 'electron.exe'))) throw new Error(`Electron introuvable dans ${electronDist}.`);
const electronVersion = JSON.parse(readFileSync(join(electronPkg, 'package.json'), 'utf8')).version;
const version = /API_VERSION = '([^']+)'/.exec(readFileSync(join(ROOT, 'services/api/src/app.ts'), 'utf8'))?.[1] ?? '0.0.0';

rmSync(OUT, { recursive: true, force: true });
cpSync(electronDist, OUT, { recursive: true, filter: (src) => !src.endsWith('default_app.asar') });
renameSync(join(OUT, 'electron.exe'), join(OUT, 'AfriKaisse.exe'));
for (const file of readdirSync(join(OUT, 'locales'))) if (!LOCALES.has(file)) rmSync(join(OUT, 'locales', file));

const app = join(OUT, 'resources', 'app');
cpSync(join(HERE, 'dist'), app, { recursive: true });
writeFileSync(join(app, 'package.json'), `${JSON.stringify({ name: 'afrikaisse-console', productName: 'AfriKaisse', version, private: true, main: 'main.cjs' }, null, 2)}\n`);

console.log(`\nConsole empaquetée : ${join(OUT, 'AfriKaisse.exe')} (AfriKaisse ${version}, Electron ${electronVersion}, ${(size(OUT) / 1e6).toFixed(0)} Mo)`);
