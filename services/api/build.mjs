import { build } from 'esbuild';

/**
 * Un seul fichier CommonJS par point d'entrée : rien à `npm install` sur
 * o2switch (compilateur bloqué, terminal cPanel limité) ni dans l'installateur.
 * CommonJS car le chargeur Node de Passenger n'est pas garanti compatible ESM.
 */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  // PGlite ne sert qu'aux tests ; pg-native est une option de pg jamais utilisée.
  external: ['@electric-sql/pglite', 'pg-native'],
  define: { __AFK_BUILD__: JSON.stringify(process.env.AFK_BUILD ?? 'local') },
};

await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/server.cjs' });
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.cjs' });
