import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITED_RESOURCES, PLAN_CODES, PLANS, TRIAL_DAYS, formatMoney } from '@afrikaisse/core';
import { buildSite, SITE_DIR, type BuildResult } from '../src/build.ts';
import { DEFAULT_APP_URL, SITE_CONFIG, resolveUrls } from '../src/config.ts';
import { PAGES, createContext, renderPage } from '../src/pages.ts';

const APP = 'https://app.exemple.td';
const SITE = 'https://www.exemple.td';
const outDir = join(SITE_DIR, '.generated', `test-dist-${process.pid}`);
let result: BuildResult;

beforeAll(async () => {
  result = await buildSite({ outDir, workName: `test-${process.pid}`, appUrl: APP, siteUrl: SITE, quiet: true });
}, 120_000);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const read = (file: string) => readFileSync(join(outDir, file), 'utf8');
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** Texte visible d'un fragment HTML. */
const text = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' '));
/** Sans aucune espace (les montants utilisent des espaces fines insécables). */
const compact = (s: string) => s.replace(/[\s  ]+/g, '');

/** Fichier du site visé par une adresse interne (`/tarifs/` → tarifs/index.html), ou null si externe. */
function internalTarget(raw: string): { file: string; hash: string } | null {
  let url = decode(raw);
  if (url.startsWith(SITE)) url = url.slice(SITE.length) || '/';
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  const [pathAndQuery = '', hash = ''] = url.split('#');
  let path = decodeURI(pathAndQuery.split('?')[0] ?? '');
  if (path.endsWith('/')) path += 'index.html';
  return { file: path.slice(1), hash };
}

describe('site public', () => {
  it('produit chaque page avec titre, description, un seul h1 et la langue', () => {
    const titles = new Set<string>();
    for (const page of PAGES) {
      expect(existsSync(join(outDir, page.file)), page.file).toBe(true);
      const html = read(page.file);
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
      expect(title, page.file).toBeTruthy();
      titles.add(title as string);
      expect(html).toMatch(/<meta name="description" content="[^"]{50,}">/);
      expect(html.match(/<h1[\s>]/g)?.length, `${page.file} : un seul h1`).toBe(1);
      expect(html).toContain('<html lang="fr" dir="ltr">');
      // La feuille de styles est bien assemblée par Vite (fichier à empreinte).
      expect(html).toMatch(/<link rel="stylesheet" crossorigin href="\/assets\/[^"]+\.css">/);
    }
    expect(titles.size).toBe(PAGES.length);
    expect(PAGES.map((p) => p.path)).toEqual(['/', '/fonctionnalites/', '/tarifs/', '/demonstration/', '/faq/', '/contact/', '/404.html']);
  });

  it("n'a aucun lien interne cassé, ni ancre manquante", () => {
    const broken: string[] = [];
    for (const page of PAGES) {
      const html = read(page.file);
      const urls = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1] as string);
      // Balises meta (og:url, og:image) : seulement les adresses, pas les couleurs ni les textes.
      for (const m of html.matchAll(/\scontent="((?:https?:)?\/[^"]*)"/g)) urls.push(m[1] as string);
      for (const m of html.matchAll(/\ssrcset="([^"]+)"/g)) urls.push(...(m[1] as string).split(',').map((part) => part.trim().split(/\s+/)[0] as string));
      for (const url of urls) {
        if (url.startsWith('#')) {
          if (!html.includes(`id="${url.slice(1)}"`)) broken.push(`${page.file} → ${url}`);
          continue;
        }
        const target = internalTarget(url);
        if (!target) continue;
        if (!existsSync(join(outDir, target.file))) {
          broken.push(`${page.file} → ${url}`);
          continue;
        }
        if (target.hash && target.file.endsWith('.html') && !read(target.file).includes(`id="${target.hash}"`)) broken.push(`${page.file} → ${url} (ancre)`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('affiche exactement les offres de packages/core/src/plans.ts', () => {
    const html = read('tarifs/index.html');
    const page = compact(text(html));
    for (const code of PLAN_CODES) {
      const plan = PLANS[code];
      expect(page).toContain(compact(plan.label));
      if (plan.monthlyPrice) expect(page).toContain(compact(formatMoney(plan.monthlyPrice, 'XAF')));
    }
    expect(page).toContain('Surdevis');
    expect(page).toContain(`${TRIAL_DAYS}jours`);

    // Tableau comparatif : une colonne par offre, dans l'ordre de PLAN_CODES.
    const row = (name: string) => {
      const tr = html.match(new RegExp(`<tr data-row="${name}">([\\s\\S]*?)</tr>`))?.[1] ?? '';
      return [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => compact(text(m[1] as string)));
    };
    expect(row('price')).toEqual(
      PLAN_CODES.map((code) => {
        const price = PLANS[code].monthlyPrice;
        return price === null ? 'Surdevis' : price === 0 ? `Gratuitpendant${TRIAL_DAYS}jours` : compact(`${formatMoney(price, 'XAF')} / mois`);
      }),
    );
    for (const resource of LIMITED_RESOURCES) {
      expect(row(resource), resource).toEqual(PLAN_CODES.map((code) => String(PLANS[code].limits[resource] ?? 'Illimité')));
    }

    // Même chose dans le résumé de l'accueil.
    const home = read('index.html');
    for (const code of PLAN_CODES) {
      const price = PLANS[code].monthlyPrice;
      if (!price) continue;
      const tr = home.match(new RegExp(`<tr data-plan="${code}">([\\s\\S]*?)</tr>`))?.[1] ?? '';
      expect(compact(text(tr))).toContain(compact(formatMoney(price, 'XAF')));
    }
  });

  it("envoie Connexion et Créer mon restaurant vers l'application choisie au build", () => {
    for (const page of PAGES) {
      const html = read(page.file);
      expect(html).toContain(`href="${APP}/"`);
      expect(html).toContain(`href="${APP}/#inscription"`);
      expect(html).not.toContain(DEFAULT_APP_URL);
      expect(html).toContain(page.indexable ? `<link rel="canonical" href="${SITE}${page.path}">` : '<meta name="robots" content="noindex">');
      expect(html).toContain(`<meta property="og:image" content="${SITE}/og-afrikaisse.png">`);
    }
    expect(resolveUrls({ SITE_APP_URL: 'https://autre.exemple/' })).toEqual({ appUrl: 'https://autre.exemple', siteUrl: 'https://www.afrikaisse.dametta.com' });
    expect(() => resolveUrls({ SITE_URL: 'pas une adresse' })).toThrow(/SITE_URL/);
  });

  it('donne un texte alternatif à chaque image et ne contient ni emoji ni auteur de photo', () => {
    const catalogue = JSON.parse(readFileSync(join(SITE_DIR, '../web/public/catalogue/catalogue.json'), 'utf8')) as { dishes: { credit?: { author?: string } }[] };
    const authors = catalogue.dishes.map((d) => d.credit?.author).filter((a): a is string => Boolean(a && a.length > 3));
    for (const page of PAGES) {
      const html = read(page.file);
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) expect(img, page.file).toMatch(/\salt="[^"]{3,}"/);
      const visible = text(html);
      expect(visible.replace(/[©®™]/g, '')).not.toMatch(/\p{Extended_Pictographic}/u);
      for (const author of authors) expect(visible, `${page.file} : auteur ${author}`).not.toContain(author);
    }
  });

  it('publie sitemap.xml et robots.txt', () => {
    const sitemap = read('sitemap.xml');
    for (const page of PAGES) {
      if (page.indexable) expect(sitemap).toContain(`<loc>${SITE}${page.path}</loc>`);
      else expect(sitemap).not.toContain(page.path);
    }
    expect(read('robots.txt')).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it('reste sous 150 Ko de JavaScript et CSS compressés', () => {
    expect(result.code.length).toBeGreaterThan(0);
    expect(result.codeGzip).toBeLessThan(150 * 1024);
  });

  it('masque téléphone et WhatsApp tant que config.ts les laisse à null', () => {
    const contact = PAGES.find((p) => p.id === 'contact');
    if (!contact) throw new Error('page contact absente');
    const base = { appUrl: APP, siteUrl: SITE };

    const empty = renderPage(contact, createContext(base));
    expect(SITE_CONFIG.phone).toBeNull();
    expect(empty).not.toContain('href="tel:');
    expect(empty).not.toContain('wa.me');

    const filled = renderPage(contact, createContext({ ...base, config: { ...SITE_CONFIG, phone: '+235 66 00 00 00', whatsapp: '235 66 00 00 00' } }));
    expect(filled).toContain('href="tel:+23566000000"');
    expect(filled).toContain('href="https://wa.me/23566000000"');

    const none = renderPage(contact, createContext({ ...base, config: { ...SITE_CONFIG, email: null, phone: null, whatsapp: null } }));
    expect(none).not.toContain('mailto:');
    expect(none).toContain('Coordonnées en cours de publication.');
  });
});
