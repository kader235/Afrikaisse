import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Paquet du site public pour un sous-domaine o2switch : `node infrastructure/site/build.mjs`.
 * Produit sortie/afrikaisse-site.zip (le site + .htaccess) et sortie/LISEZ-MOI.txt.
 * Variables transmises au build : SITE_URL (adresse du site), SITE_APP_URL (adresse de l'application).
 * Rien à installer sur l'hébergement. Ce script ne dépose rien : le dépôt se fait dans cPanel.
 */
const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, '../..');
const dist = join(racine, 'apps/site/dist');
const sortie = join(ici, 'sortie');

execSync('npm run build:site', { cwd: racine, stdio: 'inherit', env: process.env });

// Adresses réellement écrites dans les pages (et non recalculées ici) : ce que le LISEZ-MOI annonce est ce qui est livré.
const siteUrl = readFileSync(join(dist, 'robots.txt'), 'utf8').match(/Sitemap: (\S+)\/sitemap\.xml/)?.[1];
const appUrl = readFileSync(join(dist, 'index.html'), 'utf8').match(/href="([^"]+)\/#inscription"/)?.[1];
if (!siteUrl || !appUrl) throw new Error('Adresses du site introuvables dans apps/site/dist');

const commit = execSync('git rev-parse --short HEAD', { cwd: racine }).toString().trim();
const modifie = execSync('git status --porcelain', { cwd: racine }).toString().trim() ? '-modifie' : '';
const quand = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const build = `site-${commit}${modifie}-${quand}`;

const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const entries = walk(dist)
  .map((file) => ({ name: relative(dist, file).replace(/\\/g, '/'), data: readFileSync(file) }))
  .sort((a, b) => a.name.localeCompare(b.name));
// Fins de ligne Unix : le fichier part sur Linux.
entries.unshift({ name: '.htaccess', data: Buffer.from(readFileSync(join(ici, 'htaccess'), 'utf8').replace(/\r\n/g, '\n')) });

/** Archive ZIP (PKWARE, méthode deflate, noms UTF-8) écrite sans dépendance ni outil externe. */
function zip(files, when) {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // créé sous Unix, version 2.0 : permissions lues à l'extraction
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // fichier ordinaire rw-r--r--
    central.writeUInt32LE(offset, 42);
    directory.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }
  const centralBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

rmSync(sortie, { recursive: true, force: true });
mkdirSync(sortie, { recursive: true });
const archive = zip(entries, new Date());
writeFileSync(join(sortie, 'afrikaisse-site.zip'), archive);

const siteHost = new URL(siteUrl).host;
const lisezMoi = readFileSync(join(ici, 'LISEZ-MOI.txt'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replaceAll('{{SITE_URL}}', siteUrl)
  .replaceAll('{{SITE_HOST}}', siteHost)
  .replaceAll('{{DNS_NAME}}', siteHost.endsWith('.dametta.com') ? siteHost.slice(0, -'.dametta.com'.length) : siteHost)
  .replaceAll('{{APP_URL}}', appUrl)
  .replaceAll('{{APP_HOST}}', new URL(appUrl).host)
  .replaceAll('{{BUILD}}', build);
writeFileSync(join(sortie, 'LISEZ-MOI.txt'), lisezMoi.replace(/\n/g, '\r\n'));

const ko = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log(`\nVersion ${build}`);
console.log(`Site ${siteUrl} · application ${appUrl}`);
console.log(`Paquet : ${join(sortie, 'afrikaisse-site.zip')} (${entries.length} fichiers, ${ko(archive.length)})`);
console.log(`Mode d'emploi : ${join(sortie, 'LISEZ-MOI.txt')}`);
