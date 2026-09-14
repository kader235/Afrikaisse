import type { CreateTableBuilder, Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/** Phase 13 : articles de stock, mouvements (ajout seulement), recettes, épuisé automatique. */
export function stock(c: ColumnKit) {
  const base = <T extends string>(table: CreateTableBuilder<T, never>) =>
    table
      .addColumn('id', c.uuid, (col) => col.primaryKey())
      .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
      .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'));

  return {
    async up(db: Kysely<any>) {
      await base(db.schema.createTable('inventory_items'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('unit', 'text', (col) => col.notNull())
        .addColumn('min_level_milli', c.money, (col) => col.notNull())
        .addColumn('unit_cost', c.money)
        .addColumn('sort', 'integer', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('inventory_items_location_idx').on('inventory_items').columns(['location_id', 'status']).execute();

      await base(db.schema.createTable('inventory_movements'))
        .addColumn('item_id', c.uuid, (col) => col.notNull().references('inventory_items.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('quantity_milli', c.money, (col) => col.notNull())
        .addColumn('unit_cost', c.money)
        .addColumn('reason', 'text')
        .addColumn('order_id', c.uuid, (col) => col.references('orders.id'))
        .addColumn('by_user_id', c.uuid)
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('inventory_movements_item_idx').on('inventory_movements').column('item_id').execute();
      await db.schema.createIndex('inventory_movements_order_idx').on('inventory_movements').column('order_id').execute();

      await base(db.schema.createTable('recipe_items'))
        .addColumn('product_id', c.uuid, (col) => col.notNull().references('products.id'))
        .addColumn('variant_id', c.uuid, (col) => col.references('product_variants.id'))
        .addColumn('item_id', c.uuid, (col) => col.notNull().references('inventory_items.id'))
        .addColumn('quantity_milli', c.money, (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('recipe_items_product_idx').on('recipe_items').column('product_id').execute();
      await db.schema.createIndex('recipe_items_item_idx').on('recipe_items').column('item_id').execute();

      // Pourquoi un produit est épuisé : 'STOCK' = par le stock (il redevient disponible seul au réapprovisionnement).
      await db.schema.alterTable('products').addColumn('unavailable_reason', 'text').execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.alterTable('products').dropColumn('unavailable_reason').execute();
      for (const t of ['recipe_items', 'inventory_movements', 'inventory_items']) await db.schema.dropTable(t).execute();
    },
  };
}
