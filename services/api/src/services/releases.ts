import {
  AppError,
  DEFAULT_CLOUD_URL,
  compareSemver,
  parseSemver,
  releaseManifestSchema,
  signedReleaseSchema,
  uuidv7,
  type ReleaseChannel,
  type SignedRelease,
  type UpdateStatus,
} from '@afrikaisse/core';
import type { AppContext, Db } from '../context.ts';
import { isUniqueViolation } from '../lib/journal.ts';
import { verifyRelease } from '../lib/releases.ts';
import { syncTransportOf } from './sync/client.ts';

/**
 * Mises à jour (§73).
 * - Cloud : annonces signées dans `app_releases`, publiées par `cli release-publish`, servies par
 *   `GET /api/public/releases/latest`. Le serveur web ne détient pas la clé privée.
 * - Serveur local : interroge le Cloud (toutes les 6 h et à la demande), vérifie la signature avec
 *   la clé embarquée, compare les versions, garde la dernière annonce vérifiée dans `node_state`.
 *   Il n'installe jamais rien et ne touche jamais aux données.
 */

export async function publishRelease(db: Db, release: SignedRelease, now: number): Promise<void> {
  const r = signedReleaseSchema.parse(release);
  try {
    await db
      .insertInto('app_releases')
      .values({ id: uuidv7(now), channel: r.channel, version: r.version, released_at: r.releasedAt, notes: r.notes, download_url: r.downloadUrl, sha256: r.sha256, signature: r.signature, created_at: now })
      .execute();
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', `La version ${r.version} est déjà publiée sur le canal ${r.channel}.`);
    throw err;
  }
}

/** Plus haute version du canal (ordre semver, pas ordre de publication). */
export async function latestRelease(db: Db, channel: ReleaseChannel): Promise<SignedRelease | null> {
  const rows = await db.selectFrom('app_releases').selectAll().where('channel', '=', channel).execute();
  const best = rows.filter((r) => parseSemver(r.version)).sort((a, b) => compareSemver(b.version, a.version))[0];
  if (!best) return null;
  return { channel, version: best.version, releasedAt: best.released_at, notes: best.notes, downloadUrl: best.download_url, sha256: best.sha256, signature: best.signature };
}

// --- Serveur local ---------------------------------------------------------------

const K = { checkedAt: 'update_checked_at', latest: 'update_latest', error: 'update_error' };

async function getState(db: Db, key: string) {
  return (await db.selectFrom('node_state').select('value').where('key', '=', key).executeTakeFirst())?.value ?? null;
}
async function setState(db: Db, key: string, value: string) {
  await db.insertInto('node_state').values({ key, value }).onConflict((oc) => oc.column('key').doUpdateSet({ value })).execute();
}
async function clearState(db: Db, key: string) {
  await db.deleteFrom('node_state').where('key', '=', key).execute();
}

export async function updateStatus(ctx: AppContext): Promise<UpdateStatus> {
  const [checkedAt, latestRaw, error] = await Promise.all([getState(ctx.db, K.checkedAt), getState(ctx.db, K.latest), getState(ctx.db, K.error)]);
  let latest = null;
  try {
    const parsed = latestRaw ? releaseManifestSchema.safeParse(JSON.parse(latestRaw)) : null;
    latest = parsed?.success ? parsed.data : null;
  } catch {
    latest = null;
  }
  let updateAvailable = false;
  try {
    updateAvailable = !!latest && compareSemver(latest.version, ctx.version) > 0;
  } catch {
    updateAvailable = false;
  }
  return {
    enabled: ctx.config.profile === 'local' && !!ctx.config.releasePublicKey,
    currentVersion: ctx.version,
    channel: ctx.config.updateChannel,
    latest,
    updateAvailable,
    lastCheckAt: checkedAt ? Number(checkedAt) : null,
    lastError: error,
  };
}

export async function checkForUpdate(ctx: AppContext): Promise<UpdateStatus> {
  if (ctx.config.profile !== 'local') throw new AppError('CONFLICT', 'La recherche de mise à jour concerne le serveur local du restaurant.');
  await setState(ctx.db, K.checkedAt, String(ctx.now()));
  const fail = async (message: string) => {
    await setState(ctx.db, K.error, message);
    return updateStatus(ctx);
  };
  const key = ctx.config.releasePublicKey;
  if (!key) return fail('Vérification impossible : cette version ne contient pas de clé de signature.');

  const base = (ctx.config.updateUrl ?? (await getState(ctx.db, 'sync_cloud_url')) ?? DEFAULT_CLOUD_URL).replace(/\/+$/, '');
  const channel = ctx.config.updateChannel;
  let res: { status: number; body: unknown };
  try {
    res = await syncTransportOf(ctx)({ method: 'GET', url: `${base}/api/public/releases/latest?channel=${channel}` });
  } catch {
    return fail(`AfriKaisse Cloud injoignable (${base}).`);
  }
  if (res.status === 404) {
    await clearState(ctx.db, K.latest);
    await clearState(ctx.db, K.error);
    return updateStatus(ctx);
  }
  if (res.status !== 200) return fail(`Réponse inattendue du Cloud (HTTP ${res.status}).`);

  const parsed = signedReleaseSchema.safeParse(res.body);
  if (!parsed.success) return fail('Annonce de version illisible.');
  if (parsed.data.channel !== channel || !verifyRelease(parsed.data, key)) {
    ctx.log.security.warn({ version: parsed.data.version, url: base }, 'Annonce de version à la signature invalide : ignorée');
    return fail('Signature de l’annonce invalide : annonce ignorée.');
  }
  const { signature: _signature, ...manifest } = parsed.data;
  await setState(ctx.db, K.latest, JSON.stringify(manifest));
  await clearState(ctx.db, K.error);
  const status = await updateStatus(ctx);
  if (status.updateAvailable) ctx.log.system.info({ current: ctx.version, latest: manifest.version }, 'Nouvelle version disponible');
  return status;
}

/** Première recherche une minute après le démarrage, puis toutes les 6 h. Renvoie la fonction d'arrêt. */
export function startUpdateChecks(ctx: AppContext, everyMs = 6 * 3600_000, firstDelayMs = 60_000): () => void {
  const run = () => void checkForUpdate(ctx).catch((err) => ctx.log.system.warn({ err }, 'Recherche de mise à jour'));
  const first = setTimeout(run, firstDelayMs);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
