/**
 * Lance la console en développement (après `npm run build -w @afrikaisse/desktop`) :
 *   npm run start -w @afrikaisse/desktop
 * Variables utiles : AFK_HOME_DATA (dossier de données d'essai), AFK_APP_DIR (charge construite par
 * infrastructure/windows/build.mjs, pour démarrer le serveur et sauvegarder).
 *
 * ELECTRON_RUN_AS_NODE est retiré : présent dans certains environnements de build, il ferait démarrer
 * Electron comme un simple Node, sans fenêtre.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const HERE = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronExe = join(dirname(require.resolve('electron/package.json')), 'dist', 'electron.exe');
if (!existsSync(electronExe)) {
  console.error(`Electron n'est pas encore téléchargé : node ${join(dirname(require.resolve('electron/package.json')), 'install.js')}`);
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExe, [HERE, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
