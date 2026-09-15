import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { resolveUrls, type SiteConfig } from './config.ts';
import { PAGES, SITE_DIR, createContext, renderPage, robotsTxt, sitemapXml } from './pages.ts';

export { SITE_DIR };

export interface BuildOptions {
  /** Dossier produit (défaut : apps/site/dist). */
  outDir?: string;
  /** Défaut : variable SITE_APP_URL, sinon l'adresse du Cloud. */
  appUrl?: string;
  /** Défaut : variable SITE_URL, sinon https://www.afrikaisse.dametta.com. */
  siteUrl?: string;
  config?: SiteConfig;
  /** Nom du dossier de travail sous apps/site/.generated (deux builds simultanés : deux noms). */
  workName?: string;
  quiet?: boolean;
}

export interface AssetSize {
  file: string;
  bytes: number;
  gzip: number;
}

export interface BuildResult {
  outDir: string;
  appUrl: string;
  siteUrl: string;
  pages: { id: string; path: string; file: string }[];
  /** JavaScript et CSS livrés au navigateur. */
  code: AssetSize[];
  codeGzip: number;
  htmlGzip: number;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * Construit le site : les pages HTML sont écrites à partir de src/pages.ts (offres et devises lues dans
 * @afrikaisse/core), puis Vite assemble la feuille de styles, les polices et les fichiers publics.
 * Aucun JavaScript n'est envoyé au navigateur : menus et FAQ reposent sur <details>.
 */
export async function buildSite(options: BuildOptions = {}): Promise<BuildResult> {
  const env = resolveUrls();
  const appUrl = options.appUrl ?? env.appUrl;
  const siteUrl = options.siteUrl ?? env.siteUrl;
  const outDir = resolve(options.outDir ?? join(SITE_DIR, 'dist'));
  const work = join(SITE_DIR, '.generated', options.workName ?? 'build');
  const ctx = createContext({ appUrl, siteUrl, config: options.config });

  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  for (const page of PAGES) {
    const file = join(work, page.file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderPage(page, ctx));
  }
  cpSync(join(SITE_DIR, 'src/site.css'), join(work, 'site.css'));

  try {
    await build({
      configFile: false,
      root: work,
      base: '/',
      publicDir: join(SITE_DIR, 'public'),
      logLevel: options.quiet ? 'silent' : 'warn',
      build: {
        outDir,
        emptyOutDir: true,
        target: 'es2019',
        cssTarget: 'chrome80',
        reportCompressedSize: false,
        rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p.id, join(work, p.file)])) },
      },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  writeFileSync(join(outDir, 'sitemap.xml'), sitemapXml(ctx));
  writeFileSync(join(outDir, 'robots.txt'), robotsTxt(ctx));

  const size = (path: string): AssetSize => {
    const buffer = readFileSync(path);
    return { file: relative(outDir, path).replace(/\\/g, '/'), bytes: buffer.length, gzip: gzipSync(buffer, { level: 9 }).length };
  };
  const files = walk(outDir);
  const code = files.filter((f) => /\.(js|css)$/.test(f)).map(size);
  const html = files.filter((f) => f.endsWith('.html')).map(size);
  return {
    outDir,
    appUrl,
    siteUrl,
    pages: PAGES.map(({ id, path, file }) => ({ id, path, file })),
    code,
    codeGzip: code.reduce((sum, a) => sum + a.gzip, 0),
    htmlGzip: html.reduce((sum, a) => sum + a.gzip, 0),
  };
}
