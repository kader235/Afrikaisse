import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sql } from 'kysely';
import { releaseManifestSchema, signedReleaseSchema, type SignedRelease } from '@afrikaisse/core';
import { createDatabase, databaseConfigFromUrl, migrateToLatest } from '@afrikaisse/database';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDemoTenant } from './services/demo.ts';
import { EMBEDDED_RELEASE_PUBLIC_KEY, generateReleaseKeys, publicKeyOf, signRelease, verifyRelease } from './lib/releases.ts';
import { publishRelease } from './services/releases.ts';

/**
 * Commandes d'exploitation :
 *   migrate                              applique les migrations
 *   grant-platform-admin <e-mail>        donne l'accès au back-office AfriKaisse
 *   revoke-platform-admin <e-mail>       le retire
 *   release-keygen                       crée une paire de clés Ed25519 pour signer les versions
 *   release-sign <manifeste.json>        signe une annonce (AFK_RELEASE_PRIVATE_KEY) → <manifeste>.signe.json
 *   release-publish <fichier.json>       publie une annonce signée dans la base du Cloud
 *   create-demo [e-mail]                 crée une organisation « AfriKaisse Demo Restaurant » pour un prospect
 */
const USAGE = 'Usage : cli migrate | grant-platform-admin <e-mail> | revoke-platform-admin <e-mail> | release-keygen | release-sign <manifeste.json> | release-publish <manifeste.signe.json> | create-demo [e-mail]';

function sha256File(file: string): Promise<string> {
  return new Promise((ok, ko) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', ko)
      .on('end', () => ok(hash.digest('hex')));
  });
}

function readJson(file: string | undefined): Record<string, unknown> {
  if (!file) throw new Error('Fichier JSON manquant.');
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/**
 * Manifeste : { channel, version, notes, downloadUrl, sha256? , installer?, releasedAt? }.
 * `installer` (chemin relatif au manifeste) calcule l'empreinte de l'installateur à publier.
 * La clé privée n'est lue que dans l'environnement : jamais dans un fichier du dépôt.
 */
async function signManifest(file: string): Promise<SignedRelease> {
  const raw = readJson(file);
  const privateKey = process.env.AFK_RELEASE_PRIVATE_KEY;
  if (!privateKey) throw new Error('AFK_RELEASE_PRIVATE_KEY absente de l’environnement : signature impossible.');
  let sha256 = typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : undefined;
  if (typeof raw.installer === 'string') {
    const computed = await sha256File(resolve(dirname(file), raw.installer));
    if (sha256 && sha256 !== computed) throw new Error(`Empreinte du manifeste différente de celle de l'installateur (${computed}).`);
    sha256 = computed;
  }
  const manifest = releaseManifestSchema.parse({ ...raw, sha256, releasedAt: typeof raw.releasedAt === 'number' ? raw.releasedAt : Date.now() });
  const expected = process.env.AFK_RELEASE_PUBLIC_KEY ?? EMBEDDED_RELEASE_PUBLIC_KEY;
  if (expected && publicKeyOf(privateKey) !== expected.trim()) throw new Error('Cette clé privée ne correspond pas à la clé publique attendue (AFK_RELEASE_PUBLIC_KEY).');
  const signed = signRelease(manifest, privateKey);
  if (!verifyRelease(signed, publicKeyOf(privateKey))) throw new Error('Signature non vérifiable : rien n’a été écrit.');
  return signed;
}

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const [command, arg] = process.argv.slice(2);

  // Commandes sans base de données.
  if (command === 'release-keygen') {
    const keys = generateReleaseKeys();
    console.log('Clé PUBLIQUE (à embarquer : AFK_RELEASE_PUBLIC_KEY au moment de construire) :');
    console.log(keys.publicKey);
    console.log('\nClé PRIVÉE (AFK_RELEASE_PRIVATE_KEY, seulement le temps de signer ; ne jamais la committer ni l’envoyer par messagerie) :');
    console.log(keys.privateKey);
    return;
  }
  if (command === 'release-sign') {
    const signed = await signManifest(arg ?? '');
    const out = arg!.replace(/\.json$/i, '') + '.signe.json';
    writeFileSync(out, JSON.stringify(signed, null, 2) + '\n');
    console.log(`Version ${signed.version} (${signed.channel}) signée : ${out}`);
    return;
  }

  const config = loadConfig();
  const database = await createDatabase(await databaseConfigFromUrl(config.databaseUrl));
  try {
    switch (command) {
      case 'migrate': {
        const applied = await migrateToLatest(database);
        console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base déjà à jour.');
        break;
      }
      case 'db-version': {
        // Lu par le script de dépôt o2switch : « 90624 9.6.24 migrations=3 ».
        if (database.kind !== 'postgres') {
          console.log(`0 ${database.kind} migrations=?`);
          break;
        }
        const { rows } = await sql<{ num: string; nom: string }>`select current_setting('server_version_num') as num, current_setting('server_version') as nom`.execute(database.db);
        let applied = 0;
        try {
          const count = await sql<{ n: string }>`select count(*) as n from kysely_migration`.execute(database.db);
          applied = Number(count.rows[0]?.n ?? 0);
        } catch {
          applied = 0; // base neuve : la table de suivi n'existe pas encore
        }
        console.log(`${rows[0]!.num} ${rows[0]!.nom.split(' ')[0]} migrations=${applied}`);
        break;
      }
      case 'grant-platform-admin':
      case 'revoke-platform-admin': {
        if (!arg) throw new Error('Adresse e-mail manquante.');
        const res = await database.db
          .updateTable('users')
          .set({ is_platform_admin: command === 'grant-platform-admin' ? 1 : 0, updated_at: Date.now() })
          .where('email', '=', arg.trim().toLowerCase())
          .executeTakeFirst();
        if (Number(res.numUpdatedRows) === 0) throw new Error(`Aucun compte pour ${arg}.`);
        console.log(`${command === 'grant-platform-admin' ? 'Accès back-office donné à' : 'Accès back-office retiré à'} ${arg}.`);
        break;
      }
      case 'create-demo': {
        await migrateToLatest(database);
        const { app, ctx } = await buildApp({ database, config });
        try {
          const demo = await createDemoTenant(ctx, { ip: null, userAgent: 'cli' }, { email: arg });
          const role = (r: string) => ({ OWNER: 'Propriétaire', MANAGER: 'Gérant', CASHIER: 'Caissier', WAITER: 'Serveur', KITCHEN: 'Cuisine', BAR: 'Bar', STOCK_MANAGER: 'Magasinier', ADMIN: 'Administrateur' })[r] ?? r;
          console.log(`${demo.organizationName} créé : ${demo.status.tables} tables, ${demo.status.products} produits, ${demo.status.orders} commandes.`);
          console.log('Identifiants (affichés une seule fois, notez-les) :');
          for (const c of [demo.owner, ...demo.staff]) console.log(`  ${role(c.role).padEnd(14)} ${c.displayName.padEnd(18)} ${c.email}  ${c.password}`);
        } finally {
          await app.close();
        }
        break;
      }
      case 'release-publish': {
        const raw = readJson(arg);
        let signed: SignedRelease;
        if (typeof raw.signature === 'string') {
          signed = signedReleaseSchema.parse(raw);
          // Vérifiée avec la clé embarquée : une annonce que les serveurs locaux refuseraient n'est pas publiée.
          if (!config.releasePublicKey) throw new Error('Clé publique inconnue (AFK_RELEASE_PUBLIC_KEY) : impossible de vérifier la signature.');
          if (!verifyRelease(signed, config.releasePublicKey)) throw new Error('Signature invalide pour la clé publique attendue : rien n’a été publié.');
        } else {
          signed = await signManifest(arg!);
        }
        await publishRelease(database.db, signed, Date.now());
        console.log(`Version ${signed.version} publiée sur le canal ${signed.channel}.`);
        break;
      }
      default:
        console.log(USAGE);
        process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
