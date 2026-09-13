# AfriKaisse — Base de données

## Conventions (valables en PostgreSQL et en SQLite)

| Donnée | Stockage | Pourquoi |
|---|---|---|
| Identifiant | **UUID v7** (`uuid` en PostgreSQL, `text` en SQLite), généré par l'application | Créé hors ligne sans collision ; trié par date, donc des index compacts |
| Date | **millisecondes epoch UTC** (`bigint` / `integer`) | Aucune ambiguïté de fuseau ; la journée d'exploitation se calcule avec le fuseau de l'établissement |
| Montant | **entier** dans la plus petite unité de la devise (`bigint` / `integer`) | Jamais de flottant pour de l'argent ; XAF a 0 décimale, EUR 2 |
| Booléen | `0` / `1` (`smallint` / `integer`) | Même valeur lue par les deux pilotes |
| JSON | `text` sérialisé | Portable ; les requêtes n'y cherchent pas |
| Version de synchronisation | `updated_hlc` (texte triable) | Départage fiable malgré des horloges fausses |
| Clé d'isolation | `tenant_id` sur toute donnée métier | Aucune requête sans portée d'organisation |

Règles :

- **Une migration publiée n'est jamais modifiée** : on en ajoute une. Les migrations sont embarquées
  dans le code (`packages/database/src/migrate.ts`) et écrites une fois pour les deux moteurs
  (`ColumnKit` ne choisit que les types physiques).
- Les ID auto-incrémentés n'existent que comme **curseurs locaux** (`sync_events.seq`), jamais
  comme identité synchronisée.
- Les données **transactionnelles** (commandes validées, paiements, mouvements de stock) sont
  **ajoutées, jamais écrasées** : une annulation est un nouvel enregistrement.
- Le stock, les soldes et les totaux de caisse sont **calculés** à partir des mouvements, pas stockés
  comme vérité (leçon de PHARMINA).

## Classification

| Classe | Tables | Synchronisée ? |
|---|---|---|
| Données maîtres | tenants, locations, users, memberships, zones, tables, menu, produits, modificateurs, stations, taxes, promotions, recettes, réglages | Oui, dernier écrivain gagnant par HLC, audité |
| Transactions | table_sessions, orders, order_items, order_status_history, kitchen_tickets, payments, cash_sessions, inventory_movements | Oui, **ajout seulement**, l'état se déduit des événements |
| Propres au nœud | auth_sessions, refresh_tokens, node_state, print_jobs locaux | **Non** |
| Journal | sync_events, audit_logs | sync_events : c'est le transport ; audit_logs : remonté au Cloud (phase 12) |

## Tables livrées en phase 1 (migration `0001_foundation`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `tenants` | Organisation cliente (abonnement) | name, status `ACTIVE/SUSPENDED`, is_demo, plan |
| `locations` | Établissement | tenant_id, name, type, currency, timezone, country, **business_day_cutoff_min**, status |
| `users` | Identité (globale : une personne peut travailler pour deux organisations) | email (unique), display_name, password_hash, pin_hash, is_platform_admin, status |
| `memberships` | Appartenance + rôle dans une organisation (le `restaurant_users` du §56) | tenant_id, user_id (unique ensemble), role, location_id (null = tous), status |
| `auth_sessions` | Session d'un appareil | user_id, tenant_id courant, expires_at, revoked_at, revoke_reason |
| `refresh_tokens` | Jetons de renouvellement (empreinte SHA-256 seulement) | session_id, token_hash (unique), used_at |
| `devices` | Nœuds et appareils (Cloud, serveur local ; POS, KDS, mobile à venir) | kind, tenant_id, location_id, last_seen_at |
| `node_state` | Identité de CE nœud (node_id, secret JWT, port d'écoute retenu) | key, value |
| `audit_logs` | Journal d'audit non modifiable | tenant_id, actor_user_id, action, subject, entity, data, ip |
| `sync_events` | Outbox / flux de changements | seq, event_id (unique), device_id, entity_type/id, operation, payload, hlc, status, retry_count |

Adaptations du §56, justifiées dans ARCHITECTURE.md :
- `restaurants` → fusionné (tenant = organisation, location = établissement) ;
- `roles` / `permissions` → matrice dans `packages/core/src/roles.ts` (rôles fixes, identiques hors
  ligne). Si des rôles personnalisés sont demandés, ajouter `custom_roles` ;
- `restaurant_users` → `memberships`.

## Schéma cible (toutes phases)

Chaque table porte `id`, `tenant_id`, `created_at`, `updated_at`, `updated_hlc` sauf mention contraire.

### Organisation et accès — phases 1-2
- `tenants`, `locations`, `users`, `memberships`, `auth_sessions`, `refresh_tokens`, `devices`, `node_state`
- `settings` (location_id, key, value) — réglages par établissement (confirmation des commandes QR, pourboires…)
- `device_pairings` (location_id, code, expires_at, device_id) — appairage des tablettes par QR

### Salle — phase 2
- `zones` (location_id, name, sort)
- `tables` (location_id, zone_id, label, capacity, shape, x, y, width, height, rotation, status)
- `qr_codes` (table_id, token unique, revoked_at) — jeton non devinable ; régénérable si une photo circule

### Menu — phase 3
- `menu_categories` (location_id, name, sort, is_active, available_from/to)
- `products` (location_id, category_id, name, description, photo_url, price, promo_price, station_id, prep_time_sec, is_available, tax_id, allergens, tags, sort)
- `product_variants` (product_id, name, price_delta, sort)
- `modifier_groups` (location_id, name, min_select, max_select, is_required)
- `product_modifier_groups` (product_id, group_id, sort)
- `modifiers` (group_id, name, price_delta, is_available, sort)
- `stations` (location_id, kind `KITCHEN/BAR/GRILL/PIZZA/DESSERT/...`, name, printer_id)
- `taxes` (location_id, name, rate_bp — points de base, inclusive)

### Tables et commandes — phases 4-5
- `table_sessions` (location_id, table_id, opened_at, closed_at, join_code, opened_by, guests)
- `table_session_participants` (session_id, client_token, label, joined_at)
- `orders` (location_id, table_session_id, number, business_date, source `POS/WAITER/QR`, status, subtotal, discount_total, tax_total, total, currency, authority_device_id)
- `order_items` (order_id, product_id, variant_id, name_snapshot, unit_price_snapshot, quantity, note, station_id, participant_id, status, voided_by_item_id)
- `order_item_modifiers` (order_item_id, modifier_id, name_snapshot, price_delta_snapshot)
- `order_status_history` (order_id, from_status, to_status, at_hlc, by_user_id, by_device_id, reason) — **ajout seulement**
- `order_counters` (location_id, business_date, last_number) — détenu par l'autorité opérationnelle
- `service_requests` (location_id, table_session_id, kind `CALL_WAITER/BILL/HELP`, status, handled_by)

### Cuisine — phase 7
- `kitchen_tickets` (order_id, station_id, number, status, fired_at, ready_at, bumped_at)
- `kitchen_ticket_items` (ticket_id, order_item_id, quantity, status)

### Impression — phase 9
- `printers` (location_id, name, connection `TCP/USB/BLUETOOTH`, address, paper_width_mm, kind)
- `print_jobs` (location_id, printer_id, kind `KITCHEN/BAR/RECEIPT/BILL/QR`, payload, status, attempts, printed_at)

### Paiements et caisse — phases 6 et 10
- `cash_sessions` (location_id, device_id, opened_by, opened_at, opening_float, closed_by, closed_at, counted_cash, expected_cash, z_report)
- `payments` (location_id, order_id | table_session_id, cash_session_id, method `CASH/CARD/MOBILE_MONEY/ONLINE`, amount, tip, currency, reference, status)
- `payment_transactions` (payment_id, provider, provider_ref, status, raw) — pour les intégrations
- `discounts` (location_id, kind `PERCENT/FIXED/FREE_ITEM`, value, applies_to)
- `promotions` (location_id, kind, rule, schedule `HAPPY_HOUR`, code, starts_at, ends_at)

### Stock — phase 13
- `inventory_items` (location_id, name, unit, is_critical, min_level)
- `inventory_movements` (item_id, kind `IN/OUT/SALE/LOSS/ADJUST/COUNT`, quantity, unit_cost, ref_type, ref_id) — **ajout seulement**
- `recipes` (product_id | variant_id), `recipe_items` (recipe_id, item_id, quantity)

### SaaS, supervision — phases 12, 17
- `subscriptions` (tenant_id, plan, status, starts_at, ends_at)
- `entitlements` (tenant_id, payload signé, expires_at, grace_until)
- `sync_events` (déjà là), `sync_cursors` (device_id, stream, last_seq), `sync_conflicts` (event_id, entity, local, remote, resolution)
- `notifications` (location_id, audience, kind, payload, read_at)
- `backups` (device_id, kind, path, size, created_at, verified_at)
- `audit_logs` (déjà là)
