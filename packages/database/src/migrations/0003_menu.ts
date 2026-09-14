import type { ColumnDefinitionBuilder, CreateTableBuilder, Kysely } from 'kysely';
import { generateToken, uuidv7 } from '@afrikaisse/core';
import type { ColumnKit } from '../columns.ts';

/** Phase 3 : menu (catégories, produits, variantes, options), photos, QR des tables. */
export function menu(c: ColumnKit) {
  // Colonnes communes aux données maîtres synchronisées.
  const base = <T extends string>(table: CreateTableBuilder<T, never>) =>
    table
      .addColumn('id', c.uuid, (col) => col.primaryKey())
      .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
      .addColumn('location_id', c.uuid, (col) => col.notNull().references('locations.id'));
  const stamps = <T extends string>(table: CreateTableBuilder<T, never>) =>
    table
      .addColumn('status', 'text', (col) => col.notNull())
      .addColumn('created_at', c.ts, (col) => col.notNull())
      .addColumn('updated_at', c.ts, (col) => col.notNull())
      .addColumn('updated_hlc', 'text', (col) => col.notNull());
  const notNull = (col: ColumnDefinitionBuilder) => col.notNull();

  return {
    async up(db: Kysely<any>) {
      await stamps(
        base(db.schema.createTable('menu_categories'))
          .addColumn('name', 'text', notNull)
          .addColumn('sort', 'integer', notNull)
          .addColumn('is_visible', c.bool, (col) => col.notNull().defaultTo(1)),
      ).execute();
      await db.schema.createIndex('menu_categories_location_idx').on('menu_categories').column('location_id').execute();

      await db.schema
        .createTable('media')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.references('locations.id'))
        .addColumn('content_type', 'text', notNull)
        .addColumn('size', 'integer', notNull)
        .addColumn('width', 'integer', notNull)
        .addColumn('height', 'integer', notNull)
        .addColumn('sha256', 'text', notNull)
        .addColumn('bytes', c.blob, notNull)
        .addColumn('created_by', c.uuid)
        .addColumn('created_at', c.ts, notNull)
        .execute();
      await db.schema.createIndex('media_tenant_idx').on('media').column('tenant_id').execute();

      await stamps(
        base(db.schema.createTable('products'))
          .addColumn('category_id', c.uuid, (col) => col.notNull().references('menu_categories.id'))
          .addColumn('name', 'text', notNull)
          .addColumn('description', 'text')
          .addColumn('price', c.money, notNull)
          .addColumn('promo_price', c.money)
          .addColumn('prep_time_min', 'integer')
          .addColumn('photo_media_id', c.uuid, (col) => col.references('media.id'))
          .addColumn('is_available', c.bool, (col) => col.notNull().defaultTo(1))
          .addColumn('tags', 'text', notNull)
          .addColumn('allergens', 'text', notNull)
          .addColumn('sort', 'integer', notNull),
      ).execute();
      await db.schema.createIndex('products_category_idx').on('products').column('category_id').execute();
      await db.schema.createIndex('products_location_idx').on('products').column('location_id').execute();

      await stamps(
        base(db.schema.createTable('product_variants'))
          .addColumn('product_id', c.uuid, (col) => col.notNull().references('products.id'))
          .addColumn('name', 'text', notNull)
          .addColumn('price_delta', c.money, notNull)
          .addColumn('is_available', c.bool, (col) => col.notNull().defaultTo(1))
          .addColumn('sort', 'integer', notNull),
      ).execute();
      await db.schema.createIndex('product_variants_product_idx').on('product_variants').column('product_id').execute();

      await stamps(
        base(db.schema.createTable('modifier_groups'))
          .addColumn('name', 'text', notNull)
          .addColumn('min_select', 'integer', notNull)
          .addColumn('max_select', 'integer', notNull)
          .addColumn('sort', 'integer', notNull),
      ).execute();
      await db.schema.createIndex('modifier_groups_location_idx').on('modifier_groups').column('location_id').execute();

      await stamps(
        base(db.schema.createTable('modifiers'))
          .addColumn('group_id', c.uuid, (col) => col.notNull().references('modifier_groups.id'))
          .addColumn('name', 'text', notNull)
          .addColumn('price_delta', c.money, notNull)
          .addColumn('is_available', c.bool, (col) => col.notNull().defaultTo(1))
          .addColumn('sort', 'integer', notNull),
      ).execute();
      await db.schema.createIndex('modifiers_group_idx').on('modifiers').column('group_id').execute();

      await base(db.schema.createTable('product_modifier_groups'))
        .addColumn('product_id', c.uuid, (col) => col.notNull().references('products.id'))
        .addColumn('group_id', c.uuid, (col) => col.notNull().references('modifier_groups.id'))
        .addColumn('sort', 'integer', notNull)
        .addColumn('created_at', c.ts, notNull)
        .addColumn('updated_hlc', 'text', notNull)
        .execute();
      await db.schema
        .createIndex('product_modifier_groups_uq')
        .on('product_modifier_groups')
        .columns(['product_id', 'group_id'])
        .unique()
        .execute();
      await db.schema.createIndex('product_modifier_groups_group_idx').on('product_modifier_groups').column('group_id').execute();

      await base(db.schema.createTable('qr_codes'))
        .addColumn('table_id', c.uuid, (col) => col.notNull().references('dining_tables.id'))
        .addColumn('token', 'text', notNull)
        .addColumn('created_at', c.ts, notNull)
        .addColumn('revoked_at', c.ts)
        .addColumn('updated_hlc', 'text', notNull)
        .execute();
      await db.schema.createIndex('qr_codes_token_uq').on('qr_codes').column('token').unique().execute();
      await db.schema.createIndex('qr_codes_table_idx').on('qr_codes').column('table_id').execute();

      // Les tables créées en phase 2 reçoivent leur QR : chaque table active en a toujours un.
      const tables = await db.selectFrom('dining_tables').select(['id', 'tenant_id', 'location_id']).where('status', '=', 'ACTIVE').execute();
      const now = Date.now();
      for (const t of tables) {
        await db
          .insertInto('qr_codes')
          .values({
            id: uuidv7(now),
            tenant_id: t.tenant_id,
            location_id: t.location_id,
            table_id: t.id,
            token: generateToken(),
            created_at: now,
            revoked_at: null,
            updated_hlc: `${String(now).padStart(15, '0')}-00000-migration`,
          })
          .execute();
      }
    },

    async down(db: Kysely<any>) {
      for (const t of ['qr_codes', 'product_modifier_groups', 'modifiers', 'modifier_groups', 'product_variants', 'products', 'media', 'menu_categories']) {
        await db.schema.dropTable(t).execute();
      }
    },
  };
}
