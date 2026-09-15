import { buildSite } from '../src/build.ts';

/** `npm run build -w @afrikaisse/site` (ou `npm run build:site`) → apps/site/dist. */
const ko = (bytes: number) => `${(bytes / 1024).toFixed(1).replace('.', ',')} Ko`;

const result = await buildSite();
console.log(`Site construit : ${result.outDir}`);
console.log(`Application (Connexion, Créer mon restaurant) : ${result.appUrl}`);
console.log(`Adresse du site (canonique, sitemap) : ${result.siteUrl}`);
console.log(`Pages : ${result.pages.map((p) => p.path).join('  ')}`);
for (const asset of result.code) console.log(`  ${asset.file}  ${ko(asset.bytes)} (${ko(asset.gzip)} gzip)`);
console.log(`JS + CSS : ${ko(result.codeGzip)} gzip (budget 150 Ko) · HTML : ${ko(result.htmlGzip)} gzip`);
