import { uuidv7 } from '@afrikaisse/core';
import type { AppContext, Db, RequestMeta } from '../context.ts';

export interface AuditInput {
  tenantId?: string | null;
  locationId?: string | null;
  actorUserId?: string | null;
  action: string;
  subject?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  data?: unknown;
  meta?: RequestMeta;
}

/**
 * Journal d'audit. Pour tracer un ÉCHEC, appeler avec `ctx.db` et non la
 * transaction de la requête : son annulation effacerait la trace.
 */
export async function writeAudit(db: Db, ctx: AppContext, e: AuditInput): Promise<void> {
  await db
    .insertInto('audit_logs')
    .values({
      id: uuidv7(),
      tenant_id: e.tenantId ?? null,
      location_id: e.locationId ?? null,
      actor_user_id: e.actorUserId ?? null,
      actor_device_id: ctx.nodeId,
      action: e.action,
      subject: e.subject ?? null,
      entity_type: e.entityType ?? null,
      entity_id: e.entityId ?? null,
      data: e.data === undefined ? null : JSON.stringify(e.data),
      ip: e.meta?.ip ?? null,
      user_agent: e.meta?.userAgent?.slice(0, 300) ?? null,
      created_at: ctx.now(),
    })
    .execute();
}

/**
 * UPSERT / DELETE pour les données maîtres (dernier écrivain gagnant par HLC) ;
 * événements métier nommés pour les transactions, qui s'ajoutent sans jamais s'écraser (SYNC.md §4).
 */
export type ChangeOperation = 'UPSERT' | 'DELETE' | 'ORDER_PLACED' | 'ORDER_STATUS_CHANGED';

export interface ChangeInput {
  tenantId: string;
  locationId?: string | null;
  entityType: string;
  entityId: string;
  operation: ChangeOperation;
  payload: object;
  hlc: string;
}

/**
 * Journal de synchronisation (outbox), écrit DANS la transaction métier :
 * une modification sans son événement, ou l'inverse, est impossible.
 * Sur un serveur local l'événement attend l'envoi (PENDING) ; dans le Cloud il
 * est déjà « arrivé » et sert de flux de changements pour les serveurs locaux.
 */
export async function recordChange(db: Db, ctx: AppContext, c: ChangeInput): Promise<void> {
  const now = ctx.now();
  const local = ctx.config.profile === 'local';
  await db
    .insertInto('sync_events')
    .values({
      event_id: uuidv7(),
      tenant_id: c.tenantId,
      location_id: c.locationId ?? null,
      device_id: ctx.nodeId,
      entity_type: c.entityType,
      entity_id: c.entityId,
      operation: c.operation,
      payload: JSON.stringify(c.payload),
      hlc: c.hlc,
      created_at: now,
      status: local ? 'PENDING' : 'SYNCED',
      synced_at: local ? null : now,
      retry_count: 0,
      last_error: null,
    })
    .execute();
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '23505' || /UNIQUE constraint failed|duplicate key/i.test(e?.message ?? '');
}
