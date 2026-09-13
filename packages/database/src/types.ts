import type { Generated } from 'kysely';
import type { CurrencyCode, LocationType, OperatingMode, Role, TableShape } from '@afrikaisse/core';

/**
 * Conventions de colonnes, identiques en PostgreSQL (Cloud) et SQLite (local) :
 * - identifiants : UUID v7 en texte (type `uuid` côté PostgreSQL) ;
 * - dates : millisecondes epoch UTC en entier (jamais de chaîne locale) ;
 * - booléens : entier 0/1 ;
 * - montants : entier dans la plus petite unité de la devise ;
 * - JSON : texte sérialisé.
 * `updated_hlc` porte l'horloge logique hybride des données synchronisées.
 */
type Bool = 0 | 1;

export interface TenantsTable {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  is_demo: Bool;
  plan: string;
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface LocationsTable {
  id: string;
  tenant_id: string;
  name: string;
  type: LocationType;
  currency: CurrencyCode;
  timezone: string;
  country: string;
  /** Minutes après minuit où bascule la journée d'exploitation (ex. 300 = 05:00). */
  business_day_cutoff_min: number;
  /** CLOUD : le Cloud est l'autorité opérationnelle ; HYBRID : le serveur local (ADR-004). */
  operating_mode: OperatingMode;
  address: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface ZonesTable {
  id: string;
  tenant_id: string;
  location_id: string;
  name: string;
  sort: number;
  /** Taille du plan en cases. */
  plan_width: number;
  plan_height: number;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

/** « tables » dans le cahier des charges : renommée pour ne pas se confondre avec les tables SQL. */
export interface DiningTablesTable {
  id: string;
  tenant_id: string;
  location_id: string;
  zone_id: string;
  label: string;
  /** Libellé normalisé (minuscules) : « T1 » et « t1 » sont la même table. */
  label_key: string;
  capacity: number;
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface UsersTable {
  id: string;
  email: string | null;
  display_name: string;
  password_hash: string | null;
  pin_hash: string | null;
  is_platform_admin: Bool;
  status: 'ACTIVE' | 'DISABLED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface MembershipsTable {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Role;
  /** null = tous les établissements du tenant. */
  location_id: string | null;
  status: 'ACTIVE' | 'DISABLED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

/** Propre à chaque nœud : jamais synchronisé. */
export interface AuthSessionsTable {
  id: string;
  user_id: string;
  tenant_id: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  revoked_at: number | null;
  revoke_reason: string | null;
}

/** Propre à chaque nœud : jamais synchronisé. */
export interface RefreshTokensTable {
  id: string;
  session_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

export type DeviceKind = 'CLOUD' | 'LOCAL_SERVER' | 'POS' | 'KDS' | 'MOBILE' | 'PRINT_AGENT';

export interface DevicesTable {
  id: string;
  tenant_id: string | null;
  location_id: string | null;
  kind: DeviceKind;
  name: string;
  status: 'ACTIVE' | 'REVOKED';
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Identité et état de CE nœud (clé/valeur). */
export interface NodeStateTable {
  key: string;
  value: string;
}

export interface AuditLogsTable {
  id: string;
  tenant_id: string | null;
  location_id: string | null;
  actor_user_id: string | null;
  actor_device_id: string | null;
  action: string;
  /** Sujet libre indexé (ex. e-mail visé par une tentative de connexion). */
  subject: string | null;
  entity_type: string | null;
  entity_id: string | null;
  data: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
}

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface SyncEventsTable {
  /** Curseur local d'ordre d'écriture ; l'identité de l'événement est event_id. */
  seq: Generated<number>;
  event_id: string;
  tenant_id: string;
  location_id: string | null;
  device_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: string;
  hlc: string;
  created_at: number;
  status: SyncStatus;
  synced_at: number | null;
  retry_count: number;
  last_error: string | null;
}

export interface Database {
  tenants: TenantsTable;
  locations: LocationsTable;
  zones: ZonesTable;
  dining_tables: DiningTablesTable;
  users: UsersTable;
  memberships: MembershipsTable;
  auth_sessions: AuthSessionsTable;
  refresh_tokens: RefreshTokensTable;
  devices: DevicesTable;
  node_state: NodeStateTable;
  audit_logs: AuditLogsTable;
  sync_events: SyncEventsTable;
}
