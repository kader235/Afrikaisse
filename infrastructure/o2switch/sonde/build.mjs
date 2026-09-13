import { build } from 'esbuild';

// Un seul fichier à téléverser : sonde.cjs (pg embarqué).
await build({
  entryPoints: [new URL('./sonde.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: new URL('./dist/sonde.cjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  external: ['pg-native'],
  logLevel: 'info',
});
