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

// --- Phase 3 : menu, photos, QR ---------------------------------------------

export interface MenuCategoriesTable {
  id: string;
  tenant_id: string;
  location_id: string;
  name: string;
  sort: number;
  /** Masquée : reste gérée par le personnel mais n'apparaît pas sur le menu client. */
  is_visible: Bool;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface ProductsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  promo_price: number | null;
  prep_time_min: number | null;
  station_id: string | null;
  /** 'STOCK' : épuisé par le stock, rendu disponible seul au réapprovisionnement. */
  unavailable_reason: 'STOCK' | null;
  photo_media_id: string | null;
  is_available: Bool;
  /** JSON : tableau de chaînes. */
  tags: string;
  /** JSON : tableau d'allergènes (ALLERGENS). */
  allergens: string;
  sort: number;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface ProductVariantsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  product_id: string;
  name: string;
  price_delta: number;
  is_available: Bool;
  sort: number;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface ModifierGroupsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  name: string;
  min_select: number;
  max_select: number;
  sort: number;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface ModifiersTable {
  id: string;
  tenant_id: string;
  location_id: string;
  group_id: string;
  name: string;
  price_delta: number;
  is_available: Bool;
  sort: number;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

/** Un groupe d'options (« Sauces ») se réutilise sur plusieurs produits. */
export interface ProductModifierGroupsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  product_id: string;
  group_id: string;
  sort: number;
  created_at: number;
  updated_hlc: string;
}

export interface MediaTable {
  id: string;
  tenant_id: string;
  location_id: string | null;
  content_type: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  width: number;
  height: number;
  sha256: string;
  bytes: Uint8Array;
  created_by: string | null;
  created_at: number;
}

export interface QrCodesTable {
  id: string;
  tenant_id: string;
  location_id: string;
  table_id: string;
  /** Jeton non devinable présent dans l'adresse du QR. */
  token: string;
  created_at: number;
  /** Régénéré (photo du QR qui circule) ou table archivée. */
  revoked_at: number | null;
  updated_hlc: string;
}

// --- Phases 4-5 : sessions de table, commandes, appels ------------------------

export interface TableSessionsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  table_id: string;
  status: 'OPEN' | 'CLOSED';
  opened_at: number;
  opened_by: string | null;
  closed_at: number | null;
  closed_by: string | null;
  updated_at: number;
  updated_hlc: string;
}

export interface OrdersTable {
  id: string;
  tenant_id: string;
  location_id: string;
  table_session_id: string | null;
  table_id: string | null;
  /** Numéro lisible, par établissement et par journée d'exploitation. */
  number: number;
  business_date: string;
  source: 'QR' | 'POS' | 'WAITER';
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'COMPLETED' | 'CANCELLED';
  note: string | null;
  service_type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  customer_name: string | null;
  currency: CurrencyCode;
  subtotal: number;
  /** Remise sur la commande ; total = sous-total − remise. */
  discount: number;
  discount_reason: string | null;
  discount_by: string | null;
  total: number;
  /** Somme des paiements non annulés (dénormalisée, mise à jour dans la transaction du paiement). */
  paid_amount: number;
  payment_status: 'UNPAID' | 'PARTIAL' | 'PAID';
  /** Téléphone du client (commande QR) : lui seul suit sa commande. */
  client_token: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  status_changed_at: number;
  updated_hlc: string;
}

/** Noms et prix COPIÉS au moment de la commande : un changement de menu ne réécrit pas le passé. */
export interface OrderItemsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  order_id: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  variant_name: string | null;
  unit_price: number;
  quantity: number;
  total: number;
  note: string | null;
  sort: number;
  created_at: number;
  /** Poste copié au moment de la commande. */
  station_id: string | null;
  kds_status: 'QUEUED' | 'PREPARING' | 'READY';
  kds_updated_at: number | null;
}

export interface OrderItemModifiersTable {
  id: string;
  tenant_id: string;
  location_id: string;
  order_item_id: string;
  modifier_id: string;
  group_name: string;
  name: string;
  price_delta: number;
  created_at: number;
}

/** Ajout seulement. */
export interface OrderStatusHistoryTable {
  id: string;
  tenant_id: string;
  location_id: string;
  order_id: string;
  from_status: OrdersTable['status'] | null;
  to_status: OrdersTable['status'];
  reason: string | null;
  by_user_id: string | null;
  source: 'QR' | 'STAFF' | 'SYSTEM';
  at: number;
  hlc: string;
}

/** Propre au nœud qui fait autorité sur l'établissement : jamais synchronisé. */
export interface OrderCountersTable {
  location_id: string;
  business_date: string;
  last_number: number;
}

export interface ServiceRequestsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  table_id: string;
  table_session_id: string | null;
  kind: 'CALL_WAITER' | 'BILL' | 'HELP';
  status: 'OPEN' | 'DONE';
  client_token: string | null;
  created_at: number;
  handled_at: number | null;
  handled_by: string | null;
  updated_hlc: string;
}

/** Session de caisse : du fond de caisse à la clôture (Z). Une seule ouverte par établissement. */
export interface CashSessionsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  status: 'OPEN' | 'CLOSED';
  business_date: string;
  opening_float: number;
  opened_at: number;
  opened_by: string | null;
  closed_at: number | null;
  closed_by: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  note: string | null;
  /** Résumé figé à la clôture (JSON). */
  report: string | null;
  updated_at: number;
  updated_hlc: string;
}

/** Entrées et sorties d'espèces hors ventes. Ajout seulement. */
export interface CashMovementsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  cash_session_id: string;
  kind: 'IN' | 'OUT';
  amount: number;
  reason: string;
  by_user_id: string | null;
  created_at: number;
  hlc: string;
}

/** Paiement déclaré. Jamais supprimé : une erreur s'annule (VOIDED) avec motif. */
export interface PaymentsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  cash_session_id: string;
  receipt_number: number;
  business_date: string;
  method: 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'OTHER';
  amount: number;
  tendered: number;
  change_given: number;
  provider: string | null;
  reference: string | null;
  status: 'RECORDED' | 'VOIDED';
  void_reason: string | null;
  voided_by: string | null;
  voided_at: number | null;
  created_by: string | null;
  created_at: number;
  updated_hlc: string;
}

/** Part d'un paiement affectée à une commande (addition d'une table réglée en plusieurs fois). */
export interface PaymentAllocationsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  payment_id: string;
  order_id: string;
  amount: number;
  created_at: number;
}

export interface DocumentCountersTable {
  location_id: string;
  kind: string;
  last_number: number;
}

/** Poste de préparation (cuisine, grill, bar…). */
export interface StationsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  name: string;
  kind: 'KITCHEN' | 'BAR';
  sort: number;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

export interface InventoryItemsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  name: string;
  unit: 'PIECE' | 'PORTION' | 'KG' | 'G' | 'L' | 'CL' | 'ML';
  min_level_milli: number;
  unit_cost: number | null;
  sort: number;
  status: 'ACTIVE' | 'ARCHIVED';
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

/** Ajout seulement : le niveau d'un article est la somme de ses mouvements (en millièmes). */
export interface InventoryMovementsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  item_id: string;
  kind: 'IN' | 'OUT' | 'LOSS' | 'COUNT' | 'SALE' | 'SALE_CANCEL';
  quantity_milli: number;
  unit_cost: number | null;
  reason: string | null;
  order_id: string | null;
  by_user_id: string | null;
  created_at: number;
  hlc: string;
}

export interface RecipeItemsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  product_id: string;
  /** null : pour toutes les versions du produit. */
  variant_id: string | null;
  item_id: string;
  quantity_milli: number;
  created_at: number;
  updated_hlc: string;
}

export interface PrintersTable {
  id: string;
  tenant_id: string;
  location_id: string;
  name: string;
  host: string;
  port: number;
  width: number;
  station_id: string | null;
  prints_kitchen: Bool;
  prints_receipts: Bool;
  status: 'ACTIVE' | 'ARCHIVED';
  last_ok_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  updated_hlc: string;
}

/** File d'impression : propre au nœud qui imprime, jamais synchronisée. */
export interface PrintJobsTable {
  id: string;
  tenant_id: string;
  location_id: string;
  printer_id: string;
  kind: 'KITCHEN' | 'RECEIPT' | 'TEST';
  status: 'PENDING' | 'SENT' | 'FAILED';
  /** Octets ESC/POS en base64. */
  payload: string;
  attempts: number;
  last_error: string | null;
  order_id: string | null;
  next_attempt_at: number;
  created_at: number;
  sent_at: number | null;
}

export interface Database {
  printers: PrintersTable;
  print_jobs: PrintJobsTable;
  inventory_items: InventoryItemsTable;
  inventory_movements: InventoryMovementsTable;
  recipe_items: RecipeItemsTable;
  stations: StationsTable;
  cash_sessions: CashSessionsTable;
  cash_movements: CashMovementsTable;
  payments: PaymentsTable;
  payment_allocations: PaymentAllocationsTable;
  document_counters: DocumentCountersTable;
  tenants: TenantsTable;
  locations: LocationsTable;
  zones: ZonesTable;
  dining_tables: DiningTablesTable;
  menu_categories: MenuCategoriesTable;
  products: ProductsTable;
  product_variants: ProductVariantsTable;
  modifier_groups: ModifierGroupsTable;
  modifiers: ModifiersTable;
  product_modifier_groups: ProductModifierGroupsTable;
  media: MediaTable;
  qr_codes: QrCodesTable;
  table_sessions: TableSessionsTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  order_item_modifiers: OrderItemModifiersTable;
  order_status_history: OrderStatusHistoryTable;
  order_counters: OrderCountersTable;
  service_requests: ServiceRequestsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  auth_sessions: AuthSessionsTable;
  refresh_tokens: RefreshTokensTable;
  devices: DevicesTable;
  node_state: NodeStateTable;
  audit_logs: AuditLogsTable;
  sync_events: SyncEventsTable;
}
