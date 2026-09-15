import type { Kysely } from 'kysely';
import type { WireEvent } from '@afrikaisse/core';
import type { AppContext, Db } from '../../context.ts';

/**
 * Application d'un événement reçu (des deux côtés). Règles (SYNC.md §4) :
 * - données maîtres : dernier écrivain gagnant par HLC (`updated_hlc`) ;
 * - transactions (mouvements, paiements, historique) : insérées si absentes, jamais réécrites ;
 * - commandes : la ligne suit la HLC, ses lignes filles sont rejouées telles qu'envoyées.
 * Les octets (photos) voyagent en `{ $bytes: base64 }`.
 */

type AnyDb = Kysely<any>;
type Row = Record<string, unknown>;

/** Entités maîtres : type d'entité → table. */
export const MASTER_TABLES: Record<string, string> = {
  tenant: 'tenants',
  location: 'locations',
  user: 'users',
  membership: 'memberships',
  zone: 'zones',
  dining_table: 'dining_tables',
  qr_code: 'qr_codes',
  menu_category: 'menu_categories',
  product: 'products',
  product_variant: 'product_variants',
  modifier_group: 'modifier_groups',
  modifier: 'modifiers',
  product_modifier_group: 'product_modifier_groups',
  station: 'stations',
  printer: 'printers',
  inventory_item: 'inventory_items',
  recipe_item: 'recipe_items',
  table_session: 'table_sessions',
  session_guest: 'session_guests',
  service_request: 'service_requests',
  cash_session: 'cash_sessions',
  pricing_settings: 'pricing_settings',
  tax_rate: 'tax_rates',
  promotion: 'promotions',
};

/** Ajout seulement. */
const APPEND_TABLES: Record<string, string> = { cash_movement: 'cash_movements', inventory_movement: 'inventory_movements', media: 'media' };

export function encodeRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Uint8Array ? { $bytes: Buffer.from(v).toString('base64') } : v;
  return out;
}

export function decodeRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v && typeof v === 'object' && '$bytes' in (v as Row) ? Buffer.from(String((v as Row).$bytes), 'base64') : v;
  }
  return out;
}

async function upsert(db: AnyDb, table: string, raw: Row, lww: boolean) {
  const row = decodeRow(raw);
  const existing = (await db.selectFrom(table).selectAll().where('id', '=', row.id).executeTakeFirst()) as Row | undefined;
  if (!existing) {
    await db.insertInto(table).values(row).execute();
    return;
  }
  if (lww && typeof existing.updated_hlc === 'string' && typeof row.updated_hlc === 'string' && row.updated_hlc <= existing.updated_hlc) return;
  const { id, ...rest } = row;
  await db.updateTable(table).set(rest).where('id', '=', id).execute();
}

async function insertIfAbsent(db: AnyDb, table: string, raw: Row) {
  const row = decodeRow(raw);
  const existing = await db.selectFrom(table).select('id').where('id', '=', row.id).executeTakeFirst();
  if (!existing) await db.insertInto(table).values(row).execute();
}

export interface ApplyOptions {
  /** Côté Cloud : ligne à modifier avant écriture (droits), ou raison de refus. */
  guard?: (table: string, row: Row, event: WireEvent) => Promise<Row | string>;
  /** Côté serveur local : n'accepter que les lignes de son établissement. */
  onlyLocationId?: string;
}

class Rejected extends Error {}
export const isRejected = (err: unknown): err is Error => err instanceof Rejected;

/** Applique l'événement ; lève `Rejected` si la garde le refuse. Renvoie false s'il est ignoré. */
export async function applyEvent(trx: Db, event: WireEvent, options: ApplyOptions = {}): Promise<boolean> {
  const db = trx as unknown as AnyDb;
  const payload = event.payload as Row;

  const check = async (table: string, row: Row): Promise<Row | null> => {
    if (options.onlyLocationId && typeof row.location_id === 'string' && row.location_id !== options.onlyLocationId) return null;
    if (!options.guard) return row;
    const result = await options.guard(table, row, event);
    if (typeof result === 'string') throw new Rejected(result);
    return result;
  };

  if (event.entityType === 'order') {
    const rows = payload.rows as { order: Row; items: Row[]; modifiers: Row[]; history: Row[] } | undefined;
    if (!rows) return false;
    const order = await check('orders', rows.order);
    if (!order) return false;
    await upsert(db, 'orders', order, true);
    for (const item of rows.items) await upsert(db, 'order_items', item, false);
    for (const modifier of rows.modifiers) await insertIfAbsent(db, 'order_item_modifiers', modifier);
    for (const h of rows.history) await insertIfAbsent(db, 'order_status_history', h);
    return true;
  }

  if (event.entityType === 'payment') {
    if (event.operation === 'PAYMENT_RECORDED') {
      const { payment, allocations } = payload as { payment: Row; allocations: Row[] };
      const row = await check('payments', payment);
      if (!row) return false;
      await insertIfAbsent(db, 'payments', row);
      for (const a of allocations ?? []) {
        const allocation = await check('payment_allocations', a);
        if (allocation) await insertIfAbsent(db, 'payment_allocations', allocation);
      }
      return true;
    }
    const row = await check('payments', payload);
    if (!row) return false;
    await upsert(db, 'payments', row, false);
    return true;
  }

  const master = MASTER_TABLES[event.entityType];
  if (master) {
    if (event.operation === 'DELETE') {
      await db.deleteFrom(master).where('id', '=', event.entityId).execute();
      return true;
    }
    const row = await check(master, payload);
    if (!row) return false;
    await upsert(db, master, row, true);
    return true;
  }

  const append = APPEND_TABLES[event.entityType];
  if (append) {
    const row = await check(append, payload);
    if (!row) return false;
    await insertIfAbsent(db, append, row);
    return true;
  }
  return false; // sessions de connexion, entités propres au nœud : jamais rejouées
}

/** Trace l'événement reçu dans le journal du nœud (idempotence, flux d'activité des écrans). */
export async function recordReceived(trx: Db, ctx: AppContext, event: WireEvent, status: 'SYNCED' | 'CONFLICT', error?: string) {
  await trx
    .insertInto('sync_events')
    .values({
      event_id: event.eventId,
      tenant_id: event.tenantId,
      location_id: event.locationId,
      device_id: event.deviceId,
      entity_type: event.entityType,
      entity_id: event.entityId,
      operation: event.operation,
      payload: JSON.stringify(event.payload),
      hlc: event.hlc,
      created_at: event.createdAt,
      status,
      synced_at: ctx.now(),
      retry_count: 0,
      last_error: error ?? null,
    })
    .execute();
}

export function toWire(row: { event_id: string; device_id: string; tenant_id: string; location_id: string | null; entity_type: string; entity_id: string; operation: string; payload: string; hlc: string; created_at: number }): WireEvent {
  return {
    eventId: row.event_id,
    deviceId: row.device_id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    hlc: row.hlc,
    createdAt: Number(row.created_at),
  };
}
