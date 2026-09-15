import { sql, type ColumnDefinitionBuilder, type CreateTableBuilder, type Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Taxes par établissement (§47) et promotions (§48).
 * Les références à un taux (défaut, catégorie, produit) n'ont pas de clé étrangère : un événement
 * de synchronisation peut arriver avant le taux qu'il cite, et un taux n'est jamais supprimé (archivé).
 * Commandes et lignes gardent les montants et les taux du moment : l'historique ne se recalcule jamais
 * avec les réglages d'aujourd'hui.
 */
export function pricing(c: ColumnKit) {
  const base = <T extends string>(table: CreateTableBuilder<T, never>) =>
    table
      .addColumn('id', c.uuid, (col) => col.primaryKey())
      .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
      .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'));
  const stamps = <T extends string>(table: CreateTableBuilder<T, never>) =>
    table
      .addColumn('created_at', c.ts, (col) => col.notNull())
      .addColumn('updated_at', c.ts, (col) => col.notNull())
      .addColumn('updated_hlc', 'text', (col) => col.notNull());
  const notNull = (col: ColumnDefinitionBuilder) => col.notNull();

  // SQLite n'ajoute qu'une colonne par ALTER TABLE.
  const addColumns = async (db: Kysely<any>, table: string, columns: [string, string, string | number | null][]) => {
    for (const [name, type, fallback] of columns) {
      await db.schema
        .alterTable(table)
        .addColumn(name, type as 'text', (col) => (fallback === null ? col : col.notNull().defaultTo(fallback)))
        .execute();
    }
  };

  const orderColumns: [string, string, string | number | null][] = [
    ['tax_mode', 'text', 'INCLUSIVE'],
    ['tax_total', c.money, 0],
    ['taxes', 'text', null],
    ['promotion_discount', c.money, 0],
    ['order_promotion_id', c.uuid, null],
    ['order_promotion_discount', c.money, 0],
    ['promo_code', 'text', null],
    ['promo_code_promotion_id', c.uuid, null],
    ['promo_code_discount', c.money, 0],
    ['applied_promotions', 'text', null],
  ];
  const itemColumns: [string, string, string | number | null][] = [
    ['promotion_id', c.uuid, null],
    ['promotion_discount', c.money, 0],
    ['code_discount', c.money, 0],
    ['tax_rate_id', c.uuid, null],
    ['tax_rate_bp', 'integer', null],
    ['tax_name', 'text', null],
  ];

  return {
    async up(db: Kysely<any>) {
      // Réglages : une ligne par établissement (id = identifiant de l'établissement), absente = TVA incluse, sans taux.
      await stamps(
        base(db.schema.createTable('pricing_settings'))
          .addColumn('tax_mode', 'text', notNull)
          .addColumn('default_tax_rate_id', c.uuid),
      ).execute();
      await db.schema.createIndex('pricing_settings_location_uq').on('pricing_settings').column('location_id').unique().execute();

      await stamps(
        base(db.schema.createTable('tax_rates'))
          .addColumn('name', 'text', notNull)
          .addColumn('rate_bp', 'integer', notNull)
          .addColumn('sort', 'integer', notNull)
          .addColumn('status', 'text', notNull),
      ).execute();
      await db.schema.createIndex('tax_rates_location_idx').on('tax_rates').column('location_id').execute();

      await stamps(
        base(db.schema.createTable('promotions'))
          .addColumn('name', 'text', notNull)
          .addColumn('kind', 'text', notNull)
          .addColumn('scope', 'text', notNull)
          .addColumn('target_id', c.uuid)
          .addColumn('value', c.money, notNull)
          .addColumn('buy_quantity', 'integer')
          .addColumn('free_quantity', 'integer')
          .addColumn('min_amount', c.money)
          .addColumn('code', 'text')
          .addColumn('code_key', 'text')
          .addColumn('start_date', 'text')
          .addColumn('end_date', 'text')
          .addColumn('days_mask', 'integer', notNull)
          .addColumn('start_minute', 'integer')
          .addColumn('end_minute', 'integer')
          .addColumn('max_uses', 'integer')
          .addColumn('is_active', c.bool, notNull)
          .addColumn('status', 'text', notNull),
      ).execute();
      await db.schema.createIndex('promotions_location_idx').on('promotions').columns(['location_id', 'status']).execute();
      // Un code par établissement parmi les promotions non archivées (plusieurs NULL admis par les deux moteurs).
      await db.schema.createIndex('promotions_code_uq').on('promotions').columns(['location_id', 'code_key']).unique().where(sql.ref('status'), '=', 'ACTIVE').execute();

      await db.schema.alterTable('menu_categories').addColumn('tax_rate_id', c.uuid).execute();
      await db.schema.alterTable('products').addColumn('tax_rate_id', c.uuid).execute();

      await addColumns(db, 'orders', orderColumns);
      await addColumns(db, 'order_items', itemColumns);
      // Compter les utilisations d'une promotion (commandes non annulées).
      await db.schema.createIndex('orders_code_promotion_idx').on('orders').column('promo_code_promotion_id').execute();
      await db.schema.createIndex('orders_order_promotion_idx').on('orders').column('order_promotion_id').execute();
      await db.schema.createIndex('order_items_promotion_idx').on('order_items').column('promotion_id').execute();
    },

    async down(db: Kysely<any>) {
      for (const index of ['order_items_promotion_idx', 'orders_order_promotion_idx', 'orders_code_promotion_idx']) {
        await db.schema.dropIndex(index).execute();
      }
      for (const [name] of [...itemColumns].reverse()) await db.schema.alterTable('order_items').dropColumn(name).execute();
      for (const [name] of [...orderColumns].reverse()) await db.schema.alterTable('orders').dropColumn(name).execute();
      await db.schema.alterTable('products').dropColumn('tax_rate_id').execute();
      await db.schema.alterTable('menu_categories').dropColumn('tax_rate_id').execute();
      for (const t of ['promotions', 'tax_rates', 'pricing_settings']) await db.schema.dropTable(t).execute();
    },
  };
}
