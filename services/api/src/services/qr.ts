import { AppError, DEFAULT_CLOUD_URL, generateToken, isLocalNetworkHost, uuidv7, type QrList } from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { writeAudit } from '../lib/journal.ts';
import { emitRow } from './menu.ts';

/**
 * QR des tables : un jeton actif par table active. Régénérer révoque l'ancien (photo
 * du QR qui circule, QR arraché) ; archiver la table révoque le sien.
 */
export async function createQrCode(trx: Db, ctx: AppContext, table: { id: string; tenant_id: string; location_id: string }, hlc: string) {
  const id = uuidv7();
  await trx
    .insertInto('qr_codes')
    .values({ id, tenant_id: table.tenant_id, location_id: table.location_id, table_id: table.id, token: generateToken(), created_at: ctx.now(), revoked_at: null, updated_hlc: hlc })
    .execute();
  await emitRow(trx, ctx, 'qr_codes', id, hlc);
}

export async function revokeQrCodes(trx: Db, ctx: AppContext, tableId: string, hlc: string) {
  const active = await trx.selectFrom('qr_codes').select('id').where('table_id', '=', tableId).where('revoked_at', 'is', null).execute();
  for (const { id } of active) {
    await trx.updateTable('qr_codes').set({ revoked_at: ctx.now(), updated_hlc: hlc }).where('id', '=', id).execute();
    await emitRow(trx, ctx, 'qr_codes', id, hlc);
  }
}

/**
 * Adresse écrite dans les QR. Le client scanne avec ses données mobiles, sans rejoindre aucun Wi-Fi :
 * l'adresse doit être joignable depuis Internet. Ordre : AFK_PUBLIC_URL ; sur un serveur local relié,
 * l'adresse du Cloud (qui prend les commandes et les fait redescendre) ; l'origine de l'écran ; le Cloud.
 */
export async function menuBaseUrl(ctx: AppContext, origin: string | undefined): Promise<string> {
  let base = ctx.config.publicUrl;
  if (!base && ctx.config.profile === 'local') {
    base = (await ctx.db.selectFrom('node_state').select('value').where('key', '=', 'sync_cloud_url').executeTakeFirst())?.value;
  }
  base ??= origin && /^https?:\/\//.test(origin) ? origin : DEFAULT_CLOUD_URL;
  return base.replace(/\/+$/, '');
}

export async function listQrCodes(ctx: AppContext, scope: TenantScope, locationId: string, origin: string | undefined): Promise<QrList> {
  if (scope.locationId && scope.locationId !== locationId) throw new AppError('NOT_FOUND', 'Établissement introuvable.');
  const location = await ctx.db
    .selectFrom('locations as l')
    .innerJoin('tenants as t', 't.id', 'l.tenant_id')
    .select(['l.id', 'l.name', 'l.logo_media_id', 't.name as tenant_name'])
    .where('l.id', '=', locationId)
    .where('l.tenant_id', '=', scope.tenantId)
    .executeTakeFirst();
  if (!location) throw new AppError('NOT_FOUND', 'Établissement introuvable.');

  const load = () =>
    ctx.db
      .selectFrom('dining_tables as t')
      .innerJoin('zones as z', 'z.id', 't.zone_id')
      .leftJoin('qr_codes as q', (j) => j.onRef('q.table_id', '=', 't.id').on('q.revoked_at', 'is', null))
      .select(['t.id', 't.tenant_id', 't.location_id', 't.label', 't.label_key', 'z.name as zone_name', 'z.sort as zone_sort', 'q.token', 'q.created_at'])
      .where('t.location_id', '=', locationId)
      .where('t.status', '=', 'ACTIVE')
      .execute();

  let rows = await load();
  // Réparation : une table active sans QR (création interrompue) en reçoit un.
  const missing = rows.filter((r) => !r.token);
  if (missing.length > 0) {
    await ctx.db.transaction().execute(async (trx) => {
      const hlc = ctx.clock.now();
      for (const table of missing) await createQrCode(trx, ctx, table, hlc);
    });
    rows = await load();
  }

  const base = await menuBaseUrl(ctx, origin);
  const collator = new Intl.Collator('fr', { numeric: true });
  return {
    locationName: location.name,
    organizationName: location.tenant_name,
    logoUrl: location.logo_media_id ? `/api/media/${location.logo_media_id}` : null,
    menuBaseUrl: `${base}/m/`,
    reachableFromInternet: !isLocalNetworkHost(new URL(base).hostname),
    codes: rows
      .sort((a, b) => a.zone_sort - b.zone_sort || collator.compare(a.label, b.label))
      .map((r) => ({ tableId: r.id, tableLabel: r.label, zoneName: r.zone_name, token: r.token!, url: `${base}/m/${r.token}`, createdAt: r.created_at! })),
  };
}

export async function regenerateQrCode(ctx: AppContext, scope: TenantScope, tableId: string, meta: RequestMeta) {
  const table = await ctx.db.selectFrom('dining_tables').selectAll().where('id', '=', tableId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!table || (scope.locationId && table.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Table introuvable.');
  if (table.status !== 'ACTIVE') throw new AppError('CONFLICT', 'Cette table est archivée.');
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await revokeQrCodes(trx, ctx, tableId, hlc);
    await createQrCode(trx, ctx, table, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: table.location_id, actorUserId: scope.userId, action: 'floor.qr_regenerated', entityType: 'dining_table', entityId: tableId, data: { label: table.label }, meta });
  });
}
