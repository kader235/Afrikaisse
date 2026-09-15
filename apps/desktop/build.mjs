/**
 * Construit la console Windows dans apps/desktop/dist :
 *   main.cjs, preload.cjs   un fichier chacun (esbuild ; Electron reste externe, qrcode est inclus)
 *   fenetres/               fenêtres locales (attente, appairage) et polices Roboto
 *   afrikaisse.ico          icône (même dessin que l'installateur ; carré bleu en PNG si Python manque)
 *
 * Usage : npm run build -w @afrikaisse/desktop
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '../..');
const DIST = join(HERE, 'dist');
const require = createRequire(import.meta.url);

rmSync(DIST, { recursive: true, force: true });
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], legalComments: 'none', logLevel: 'info' };
await build({ ...common, entryPoints: [join(HERE, 'src/main.ts')], outfile: join(DIST, 'main.cjs') });
await build({ ...common, entryPoints: [join(HERE, 'src/preload.ts')], outfile: join(DIST, 'preload.cjs') });

cpSync(join(HERE, 'src/fenetres'), join(DIST, 'fenetres'), { recursive: true });
// Roboto embarquée (licence OFL), comme l'application web : les fenêtres marchent hors ligne.
const fonts = join(dirname(require.resolve('@fontsource/roboto/package.json', { paths: [join(ROOT, 'apps/web')] })), 'files');
mkdirSync(join(DIST, 'fenetres/polices'), { recursive: true });
for (const weight of [400, 500]) copyFileSync(join(fonts, `roboto-latin-${weight}-normal.woff2`), join(DIST, `fenetres/polices/roboto-${weight}.woff2`));

const ico = join(DIST, 'afrikaisse.ico');
const python = spawnSync(process.env.PYTHON ?? 'python', [join(ROOT, 'infrastructure/windows/dessiner-icone.py'), ico], { stdio: 'inherit', timeout: 60_000, killSignal: 'SIGKILL' });
if (python.status !== 0 || !existsSync(ico)) {
  console.warn('Python + Pillow indisponibles : icône de repli (carré bleu) pour la zone de notification.');
  const { PNG } = require('pngjs');
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) << 2;
      const ticket = x >= 9 && x <= 22 && y >= 6 && y <= 25;
      png.data.set(ticket ? [255, 255, 255, 255] : [6, 95, 212, 255], i);
    }
  }
  writeFileSync(join(DIST, 'afrikaisse.png'), PNG.sync.write(png));
}
console.log(`\nConsole construite : ${DIST}`);
