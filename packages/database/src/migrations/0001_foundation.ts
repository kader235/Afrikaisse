import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Phase 1 : identité, multi-tenant, sessions, appareils, audit, journal de
 * synchronisation. Écrite avec le constructeur de schéma de Kysely pour rester
 * identique en PostgreSQL et en SQLite ; seuls les types passent par ColumnKit.
 */
export function foundation(c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('tenants')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('is_demo', c.bool, (col) => col.notNull().defaultTo(0))
        .addColumn('plan', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();

      await db.schema
        .createTable('locations')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('type', 'text', (col) => col.notNull())
        .addColumn('currency', 'text', (col) => col.notNull())
        .addColumn('timezone', 'text', (col) => col.notNull())
        .addColumn('country', 'text', (col) => col.notNull())
        .addColumn('business_day_cutoff_min', 'integer', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('locations_tenant_idx').on('locations').column('tenant_id').execute();

      await db.schema
        .createTable('users')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('email', 'text')
        .addColumn('display_name', 'text', (col) => col.notNull())
        .addColumn('password_hash', 'text')
        .addColumn('pin_hash', 'text')
        .addColumn('is_platform_admin', c.bool, (col) => col.notNull().defaultTo(0))
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema.createIndex('users_email_uq').on('users').column('email').unique().execute();

      await db.schema
        .createTable('memberships')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull().references('tenants.id'))
        .addColumn('user_id', c.uuid, (col) => col.notNull().references('users.id'))
        .addColumn('role', 'text', (col) => col.notNull())
        .addColumn('location_id', c.uuid, (col) => col.references('locations.id'))
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .addColumn('updated_hlc', 'text', (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex('memberships_tenant_user_uq')
        .on('memberships')
        .columns(['tenant_id', 'user_id'])
        .unique()
        .execute();
      await db.schema.createIndex('memberships_user_idx').on('memberships').column('user_id').execute();

      await db.schema
        .createTable('auth_sessions')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('user_id', c.uuid, (col) => col.notNull().references('users.id'))
        .addColumn('tenant_id', c.uuid, (col) => col.references('tenants.id'))
        .addColumn('user_agent', 'text')
        .addColumn('ip', 'text')
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('last_used_at', c.ts, (col) => col.notNull())
        .addColumn('expires_at', c.ts, (col) => col.notNull())
        .addColumn('revoked_at', c.ts)
        .addColumn('revoke_reason', 'text')
        .execute();
      await db.schema.createIndex('auth_sessions_user_idx').on('auth_sessions').column('user_id').execute();

      await db.schema
        .createTable('refresh_tokens')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('session_id', c.uuid, (col) => col.notNull().references('auth_sessions.id'))
        .addColumn('token_hash', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('expires_at', c.ts, (col) => col.notNull())
        .addColumn('used_at', c.ts)
        .execute();
      await db.schema
        .createIndex('refresh_tokens_hash_uq')
        .on('refresh_tokens')
        .column('token_hash')
        .unique()
        .execute();
      await db.schema
        .createIndex('refresh_tokens_session_idx')
        .on('refresh_tokens')
        .column('session_id')
        .execute();

      await db.schema
        .createTable('devices')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid, (col) => col.references('tenants.id'))
        .addColumn('location_id', c.uuid, (col) => col.references('locations.id'))
        .addColumn('kind', 'text', (col) => col.notNull())
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('last_seen_at', c.ts)
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('updated_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema.createIndex('devices_tenant_idx').on('devices').column('tenant_id').execute();

      await db.schema
        .createTable('node_state')
        .addColumn('key', 'text', (col) => col.primaryKey())
        .addColumn('value', 'text', (col) => col.notNull())
        .execute();

      await db.schema
        .createTable('audit_logs')
        .addColumn('id', c.uuid, (col) => col.primaryKey())
        .addColumn('tenant_id', c.uuid)
        .addColumn('location_id', c.uuid)
        .addColumn('actor_user_id', c.uuid)
        .addColumn('actor_device_id', c.uuid)
        .addColumn('action', 'text', (col) => col.notNull())
        .addColumn('subject', 'text')
        .addColumn('entity_type', 'text')
        .addColumn('entity_id', 'text')
        .addColumn('data', 'text')
        .addColumn('ip', 'text')
        .addColumn('user_agent', 'text')
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .execute();
      await db.schema
        .createIndex('audit_logs_tenant_created_idx')
        .on('audit_logs')
        .columns(['tenant_id', 'created_at'])
        .execute();
      await db.schema
        .createIndex('audit_logs_subject_idx')
        .on('audit_logs')
        .columns(['subject', 'action', 'created_at'])
        .execute();

      await db.schema
        .createTable('sync_events')
        .addColumn('seq', c.autoPk.type, c.autoPk.build)
        .addColumn('event_id', c.uuid, (col) => col.notNull())
        .addColumn('tenant_id', c.uuid, (col) => col.notNull())
        .addColumn('location_id', c.uuid)
        .addColumn('device_id', c.uuid, (col) => col.notNull())
        .addColumn('entity_type', 'text', (col) => col.notNull())
        .addColumn('entity_id', 'text', (col) => col.notNull())
        .addColumn('operation', 'text', (col) => col.notNull())
        .addColumn('payload', 'text', (col) => col.notNull())
        .addColumn('hlc', 'text', (col) => col.notNull())
        .addColumn('created_at', c.ts, (col) => col.notNull())
        .addColumn('status', 'text', (col) => col.notNull())
        .addColumn('synced_at', c.ts)
        .addColumn('retry_count', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('last_error', 'text')
        .execute();
      await db.schema.createIndex('sync_events_event_uq').on('sync_events').column('event_id').unique().execute();
      await db.schema
        .createIndex('sync_events_status_seq_idx')
        .on('sync_events')
        .columns(['status', 'seq'])
        .execute();
      await db.schema
        .createIndex('sync_events_tenant_seq_idx')
        .on('sync_events')
        .columns(['tenant_id', 'seq'])
        .execute();
    },

    async down(db: Kysely<any>) {
      for (const t of [
        'sync_events',
        'audit_logs',
        'node_state',
        'devices',
        'refresh_tokens',
        'auth_sessions',
        'memberships',
        'users',
        'locations',
        'tenants',
      ]) {
        await db.schema.dropTable(t).execute();
      }
    },
  };
}
