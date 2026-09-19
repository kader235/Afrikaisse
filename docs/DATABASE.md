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
| Propres au nœud | auth_sessions, refresh_tokens, node_state, print_jobs locaux, error_logs, screen_heartbeats, app_releases, colonnes de supervision de `devices` | **Non** |

| Propres au nœud | auth_sessions, refresh_tokens, node_state, print_jobs locaux, notifications, notification_reads, notification_marks | **Non** |
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

## Tables livrées en phase 2 (migration `0002_floor`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `locations` (+) | Ajouts | **operating_mode** `CLOUD/HYBRID` (autorité opérationnelle, ADR-004), address, phone |
| `zones` | Zone d'un établissement (salle, terrasse, VIP) | location_id, name, sort, **plan_width**, **plan_height** (en cases), status |
| `dining_tables` | Table du plan (« tables » du cahier des charges, renommée pour ne pas se confondre avec les tables SQL) | location_id, zone_id, label, **label_key** (minuscules), capacity, shape `SQUARE/ROUND/RECT`, **x, y, w, h** (cases), status |

- Unicité du libellé par établissement **parmi les tables actives** : index unique partiel
  `(location_id, label_key) WHERE status = 'ACTIVE'`, identique en PostgreSQL et SQLite.
- Rien n'est supprimé : zones et tables s'archivent. Les commandes (phase 5) pourront toujours
  pointer vers une table archivée.

## Tables livrées en phase 3 (migration `0003_menu`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `menu_categories` | Catégorie du menu d'un établissement | name, sort, **is_visible** (masquée = gérée mais absente du menu client), status |
| `products` | Article | category_id, name, description, **price**, **promo_price**, prep_time_min, photo_media_id, **is_available**, tags (JSON), allergens (JSON), sort, status |
| `product_variants` | Version (taille, portion) | product_id, name, **price_delta**, is_available, sort, status |
| `modifier_groups` | Groupe d'options réutilisable (Cuisson, Sauces) | name, **min_select**, **max_select**, sort, status |
| `modifiers` | Option d'un groupe | group_id, name, price_delta, is_available, sort, status |
| `product_modifier_groups` | Lien produit ↔ groupe | product_id, group_id (unique ensemble), sort ; retiré = supprimé (événement `DELETE`) |
| `media` | Photo | content_type, size, width, height, **sha256**, **bytes** (`bytea` / `blob`) |
| `qr_codes` | QR d'une table | table_id, **token** (unique, 128 bits), revoked_at |

- Les photos vivent **dans la base** : sauvegardées avec elle, et le serveur local n'a pas de dossier
  à synchroniser à part. L'événement de synchronisation d'une photo ne porte que ses métadonnées ; le
  moteur de synchronisation demandera les octets par l'identifiant.
- La migration donne un QR à chaque table active existante. Ensuite, chaque table reçoit le sien à sa
  création, et son QR est révoqué quand elle est archivée.

## Tables livrées en phases 4-5 (migration `0004_orders`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `table_sessions` | Occupation d'une table, du premier plat à la libération | table_id, status `OPEN/CLOSED`, opened_at/by, closed_at/by ; **une seule session ouverte par table** (index unique partiel) |
| `orders` | Commande | table_session_id, table_id, **number**, **business_date**, source `QR/POS/WAITER`, status, note, currency, subtotal, total, client_token, created_by, status_changed_at ; **unique (location_id, business_date, number)** |
| `order_items` | Ligne | product_id, variant_id, **name**, **variant_name**, **unit_price**, quantity, total, note — noms et prix **copiés** |
| `order_item_modifiers` | Options choisies | modifier_id, **group_name**, **name**, **price_delta** — copiés |
| `order_status_history` | Transitions (ajout seulement) | from_status, to_status, reason, by_user_id, source `QR/STAFF/SYSTEM`, at, hlc |
| `order_counters` | Dernier numéro par établissement et journée | clé (location_id, business_date) ; incrément atomique par `INSERT … ON CONFLICT DO UPDATE … RETURNING` ; **propre au nœud qui fait autorité** |
| `service_requests` | Appel d'une table | kind `CALL_WAITER/BILL/HELP`, status `OPEN/DONE`, handled_at/by |

Index ajouté : `sync_events (location_id, seq)`, qui fait du journal de synchronisation le flux
d'activité des écrans.

## Tables livrées en phase 6 (migration `0005_pos`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `orders` (colonnes ajoutées) | Type de service, remise, paiement | `service_type`, `customer_name`, `discount`, `discount_reason`, `discount_by`, `paid_amount` (somme des paiements non annulés, mise à jour dans la transaction du paiement), `payment_status` `UNPAID/PARTIAL/PAID` |
| `cash_sessions` | Du fond de caisse à la clôture Z | status `OPEN/CLOSED`, business_date, opening_float, opened_at/by, closed_at/by, counted_cash, expected_cash, difference, note, **report** (résumé figé en JSON) ; **une seule ouverte par établissement** (index unique partiel) |
| `cash_movements` | Entrées/sorties d'espèces hors ventes (ajout seulement) | kind `IN/OUT`, amount, reason, by_user_id |
| `payments` | Paiement déclaré, jamais supprimé | cash_session_id, **receipt_number** (unique par établissement), method, amount, tendered, change_given, provider, reference, status `RECORDED/VOIDED`, void_reason/by/at |
| `payment_allocations` | Part d'un paiement affectée à chaque commande | payment_id, order_id, amount |
| `document_counters` | Numéros de documents qui ne repartent jamais à zéro | clé (location_id, kind) ; `RECEIPT` |

## Tables livrées en phase 7 (migration `0006_kitchen`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `stations` | Poste de préparation | name, kind `KITCHEN/BAR`, sort, status ; « Cuisine » et « Bar » créés avec chaque établissement (et pour les établissements existants par la migration) |
| `products` (colonne ajoutée) | Poste du produit | `station_id` (null : premier poste Cuisine) |
| `order_items` (colonnes ajoutées) | Routage et avancement en cuisine | `station_id` (copié à la commande), `kds_status` `QUEUED/PREPARING/READY`, `kds_updated_at` ; index (station_id, kds_status) |

## Tables livrées en phase 13 (migration `0007_stock`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `inventory_items` | Article de stock | name, unit, `min_level_milli`, unit_cost, status |
| `inventory_movements` | Mouvement, **ajout seulement** | item_id, kind `IN/OUT/LOSS/COUNT/SALE/SALE_CANCEL`, `quantity_milli` signé, unit_cost, reason, order_id, by_user_id |
| `recipe_items` | Ligne de recette | product_id, variant_id (null : toutes versions), item_id, `quantity_milli` |
| `products` (colonne ajoutée) | Motif d'épuisement | `unavailable_reason` : `STOCK` ou null |

Quantités en **millièmes entiers**. Le niveau n'est pas stocké : c'est `SUM(quantity_milli)`.
Écart assumé avec le schéma cible : pas de table `recipes` séparée, la recette est l'ensemble des lignes d'un produit.

## Tables livrées en phase 9 (migration `0008_printing`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `printers` | Imprimante réseau (donnée maître, synchronisée) | name, host, port, width, station_id, prints_kitchen, prints_receipts, last_ok_at, last_error |
| `print_jobs` | File d'impression, **propre au nœud** (jamais synchronisée) | printer_id, kind `KITCHEN/RECEIPT/TEST`, status, payload (ESC/POS en base64), attempts, next_attempt_at, last_error, order_id |

## Tables livrées pour les taxes et promotions (migration `0011_pricing`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `pricing_settings` | Réglages de taxe d'un établissement (donnée maître synchronisée, `pricing_settings`) | id = location_id, `tax_mode` `INCLUSIVE/EXCLUSIVE`, `default_tax_rate_id` ; ligne absente = TVA incluse, sans taux |
| `tax_rates` | Taux de taxe (synchronisé, `tax_rate`) | name, `rate_bp` (points de base : 1800 = 18 %), sort, status |
| `promotions` | Promotion (synchronisée, `promotion`) | name, kind `PERCENT/AMOUNT/FREE_ITEM`, scope `ORDER/CATEGORY/PRODUCT`, target_id, value, buy_quantity, free_quantity, min_amount, code, **code_key** (majuscules, unique par établissement parmi les non archivées : index unique partiel), start_date, end_date, **days_mask** (bit 0 = lundi, 0 = tous), start_minute, end_minute, max_uses, is_active, status |
| `menu_categories`, `products` (colonne ajoutée) | Taux propre | `tax_rate_id` (null : hérité) |
| `orders` (colonnes ajoutées) | Montants figés à la commande | `tax_mode`, `tax_total`, `taxes` (JSON par taux), `promotion_discount`, `order_promotion_id`, `order_promotion_discount`, `promo_code`, `promo_code_promotion_id`, `promo_code_discount`, `applied_promotions` (JSON récapitulatif) ; index sur les deux identifiants de promotion |
| `order_items` (colonnes ajoutées) | Promotion et taux copiés | `promotion_id`, `promotion_discount`, `code_discount`, `tax_rate_id`, `tax_rate_bp`, `tax_name` ; index sur `promotion_id` |

Total d'une commande = `subtotal` − `promotion_discount` − `discount` (+ `tax_total` en hors taxe).
Les références à un taux n'ont pas de clé étrangère (un événement peut précéder le taux qu'il cite ; un
taux n'est jamais supprimé). Les utilisations d'une promotion ne sont pas stockées : elles se comptent
sur les commandes non annulées, donc restent justes après synchronisation. SQL commun à SQLite et
PostgreSQL 9.6 : ni colonne d'identité, ni colonne générée.

## Tables livrées pour §67-§73 (migration `0013_platform`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `devices` (colonnes ajoutées) | Ce que le Cloud sait d'un serveur local relié | app_version, last_push_at, last_pull_at, reported_pending, reported_failed, reported_conflicts, reported_at |
| `error_logs` | Erreurs 500 du nœud, lues par le back-office ; bornée à 2 000 lignes et 30 jours | request_id, method, route (motif), status, code, message nettoyé, tenant_id (sans clé étrangère), node_id |
| `screen_heartbeats` | Signe de vie des écrans cuisine | id (tiré par l'écran), tenant_id, location_id, kind `KDS`, station_id, name, user_id, last_seen_at ; lignes de plus de 30 jours supprimées |
| `app_releases` | Annonces de version signées (Cloud) | channel, version (unique par canal), released_at, notes, download_url, sha256, signature |

**Rien n'est synchronisé** : ce sont des états du nœud qui les écrit. Le Cloud apprend l'état d'un
serveur local par les en-têtes de ses appels (`x-afk-version`, `x-afk-pending`, `x-afk-failed`,
`x-afk-conflicts`), pas par le flux d'événements. Écrit sans identité ni colonne générée (PostgreSQL
9.6 d'o2switch) ; SQLite ajoute une colonne par instruction, d'où sept `ALTER TABLE`.

## Tables livrées pour les notifications (§42, migration `0012_notifications`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `notifications` | Notification d'un établissement, **propre au nœud** | `seq` (curseur local auto-incrémenté, clé primaire), `id` UUID v7 unique, tenant_id, location_id, kind `ORDER_NEW/ORDER_READY/WAITER_CALL/BILL_REQUESTED/KITCHEN_PROBLEM/STOCK_LOW`, `audience` (permission qui la rend visible), urgent 0/1, `data` (JSON brut : numéro, table, article…), entity_type, entity_id, `dedupe_key` (unique, NULL permis), created_by (l'auteur ne la reçoit pas), created_at ; index (location_id, seq) et (location_id, created_at) |
| `notification_reads` | Lue par une personne | clé (notification_id, user_id), read_at |
| `notification_marks` | « Tout marquer lu » : repère par personne et établissement | clé (user_id, location_id), `read_seq`, updated_at |

Non lue = `seq > read_seq` et aucune ligne dans `notification_reads`. Rétention 30 jours (purge au « tout marquer lu »).
Aucune colonne nouvelle pour les temps de préparation : ils se calculent depuis `order_status_history`, `order_items.kds_updated_at` et `products.prep_time_min`.
SQL compatible PostgreSQL 9.6 et SQLite : `bigserial` / `integer autoincrement`, `ON CONFLICT` (9.5+), clés primaires composées, index uniques simples.

## Tables livrées pour le menu client (migration `0014_client`)

| Table | Rôle | Colonnes clés |
|---|---|---|
| `locations` (colonnes ajoutées) | Réglages du menu client | `table_code_required` 0/1 (défaut 0), `bill_mode` `SHARED/PER_CUSTOMER` (défaut `SHARED`) |
| `table_sessions` (colonne ajoutée) | Code de table (I-9) | `join_code` : 4 chiffres tirés à l'ouverture (générateur cryptographique), renouvelable ; null pour les tables ouvertes avant la migration (bouton « Générer ») |
| `session_guests` | Téléphones d'une table ouverte (§23) | table_session_id, client_token, nickname (null : « Client n », rang d'arrivée), joined_at, updated_at, updated_hlc ; **unique (table_session_id, client_token)** ; synchronisée comme donnée maître (`session_guest`, UPSERT) |
| `service_requests` (colonnes ajoutées) | Addition demandée par le client (I-7) | `payment_method` `CASH/MOBILE_MONEY/CARD`, `bill_scope` `TABLE/MINE` |

Index ajouté : `orders (location_id, created_at)` pour les recommandations « Populaires ».
Les échecs de code sont comptés dans `audit_logs` (`table.code_failed`, par session), jamais en mémoire.
Au regroupement de deux tables, les clients de la table d'origine rejoignent la table d'accueil.

## Schéma cible (toutes phases)

Chaque table porte `id`, `tenant_id`, `created_at`, `updated_at`, `updated_hlc` sauf mention contraire.

### Organisation et accès — phases 1-2
- `tenants`, `locations`, `users`, `memberships`, `auth_sessions`, `refresh_tokens`, `devices`, `node_state`
- `settings` (location_id, key, value) — réglages par établissement (confirmation des commandes QR, pourboires…)
- `device_pairings` (location_id, code, expires_at, device_id) — appairage des tablettes par QR

### Salle — phase 2 (livrée) et QR — phase 3
- `zones` (location_id, name, sort, plan_width, plan_height, status) — livrée
- `dining_tables` (location_id, zone_id, label, label_key, capacity, shape, x, y, w, h, status) — livrée ; pivoter = échanger w et h
- `qr_codes` (table_id, token unique, revoked_at) — phase 3 : jeton non devinable, régénérable si une photo circule

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
- remises et promotions : **livrées** (`orders.discount` pour la remise manuelle ; `promotions`, `tax_rates`, `pricing_settings` en `0011_pricing`)

### Stock — phase 13
- `inventory_items` (location_id, name, unit, is_critical, min_level)
- `inventory_movements` (item_id, kind `IN/OUT/SALE/LOSS/ADJUST/COUNT`, quantity, unit_cost, ref_type, ref_id) — **ajout seulement**
- `recipes` (product_id | variant_id), `recipe_items` (recipe_id, item_id, quantity)

### Abonnements — phase 17 (en place)
- `tenants.plan` (`TRIAL/STARTER/PRO/ENTERPRISE`) et `tenants.plan_expires_at` (migration `0010_plans`,
  null = sans échéance, cas des organisations antérieures). Les limites de chaque offre vivent dans
  `packages/core/src/plans.ts`, pas en base : changer une offre ne demande aucune migration.
- Révocation d'un serveur local : `devices.status = 'REVOKED'` et `secret_hash` effacé.

### Mise en route et démonstration — §70-71 (migration `0015_onboarding`, en place)
- `locations.logo_media_id` : logo (une ligne de `media`), repris sur le reçu, les chevalets QR et le menu client.
- `locations.setup_skipped` : étapes de l'assistant passées par le propriétaire (tableau JSON) ;
  null = assistant jamais commencé. Tout le reste de l'avancement se **calcule** depuis les données
  (tables, produits, membres, imprimantes, journal `setup.test_completed`).
- `locations.setup_completed_at` : assistant terminé (il ne s'ouvre plus tout seul).
- Colonnes nullables sans valeur calculée, synchronisées avec la ligne de l'établissement.
- Démonstration : `tenants.is_demo = 1` et `plan_expires_at` null ; aucune table dédiée, tout le
  contenu passe par les services (commandes, paiements, caisses datés dans le passé).

### Supervision
- En place (`0013_platform`) : `error_logs`, `screen_heartbeats`, `app_releases`, colonnes de supervision de `devices`.
- Les sauvegardes du serveur local sont lues sur disque (`listBackups`), pas en base.
- À venir : `sync_cursors` (device_id, stream, last_seq), `sync_conflicts` (event_id, entity, local, remote, resolution), `notifications` (location_id, audience, kind, payload, read_at)

### Menu du jour (`0022_daily_menu`)
- `daily_menus` (donnée maître, synchronisée) : `location_id`, `start_date`, `end_date` (jours d'exploitation
  AAAA-MM-JJ, bornes incluses ; identiques pour un menu d'un jour), `product_ids` (tableau JSON d'identifiants,
  sans clé étrangère : un événement peut arriver avant le plat), `status` (`ACTIVE` / `ARCHIVED`), `updated_hlc`.
- Règle : un menu d'un seul jour l'emporte sur une période ; à égalité, le plus récemment modifié, puis l'identifiant.
- Jamais supprimé (archivé). « Épuisé » n'est pas ici : c'est `products.is_available`.

