# AfriKaisse — API

- Documentation OpenAPI 3.1 générée depuis le code : **`GET /api/openapi.json`**
  (à ouvrir dans Swagger Editor, Scalar, Bruno, Postman…).
- Les schémas d'entrée et de réponse sont les objets Zod de `packages/core`. Le serveur valide les
  entrées **et** les réponses, et les clients importent les mêmes types.

## Conventions

| Sujet | Règle |
|---|---|
| Préfixe | `/api` |
| Format | JSON, UTF-8 ; dates en millisecondes epoch UTC ; montants en entiers (plus petite unité) |
| Identifiants | UUID v7 ; un identifiant malformé → `400` |
| Authentification | `Authorization: Bearer <jeton d'accès>` (15 min) |
| Isolation | Toute route métier est bornée à l'organisation de la session. Un identifiant d'une autre organisation répond **404**, jamais 403. |
| Erreurs | `{ "error": { "code", "message", "details?" } }` |

| Code | HTTP | Sens |
|---|---|---|
| `VALIDATION` | 400 | Données invalides (`details` : chemin + message) |
| `UNAUTHENTICATED`, `TOKEN_INVALID`, `INVALID_CREDENTIALS` | 401 | Connexion requise ou expirée |
| `FORBIDDEN` | 403 | Rôle insuffisant |
| `TENANT_SUSPENDED` | 403 | Organisation suspendue |
| `ACCOUNT_DISABLED` | 403 | Compte ou accès désactivé |
| `NOT_FOUND` | 404 | Absent **ou hors de votre organisation** |
| `CONFLICT` | 409 | Doublon, règle d'intégrité (dernier propriétaire…) |
| `TOO_MANY_ATTEMPTS` | 429 | Verrouillage de connexion |
| `INTERNAL` | 500 | Erreur serveur (détail dans les journaux, jamais dans la réponse) |

## Session

```text
POST /api/auth/login ─► { accessToken, expiresAt, refreshToken?, me }
   navigateur (en-tête x-afk-client: web) : refreshToken en cookie httpOnly SameSite=Strict, Path=/api/auth
   application native : refreshToken dans le corps → stockage sécurisé de l'appareil
POST /api/auth/refresh ─► nouveau couple ; l'ancien jeton de renouvellement devient inutilisable
   rejoué dans les 10 s  → 401 sans révocation (deux onglets simultanés)
   rejoué plus tard      → 401 ET révocation de toute la session (vol probable)
```

`me` porte : utilisateur, organisation courante, `tenantAccess` (`OK`, `SUSPENDED`, `DISABLED`,
`REVOKED`, `NONE`), rôle, **permissions effectives**, établissements visibles, appartenances.
Les interfaces s'appuient sur `permissions`. Le serveur revérifie toujours.

## Routes de la phase 1

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/health` | — | État du nœud (profil, base, version) |
| POST | `/api/auth/register` | — | Organisation + établissement + propriétaire (profil local : une seule fois) |
| POST | `/api/auth/login` | — | Connexion (verrouillage après 5 échecs consécutifs en 15 min) |
| POST | `/api/auth/refresh` | — | Rotation du jeton de renouvellement |
| POST | `/api/auth/logout` | connecté | Révoque la session |
| GET | `/api/auth/me` | connecté | Identité, droits, établissements |
| POST | `/api/auth/switch-tenant` | membre | Change d'organisation courante |
| POST | `/api/auth/password` | connecté | Change son mot de passe (déconnecte les autres appareils) |
| GET | `/api/tenant` | `tenant.read` | Organisation et établissements |
| PATCH | `/api/tenant` | `tenant.update` | Renommer |
| GET | `/api/team` | `users.read` | Membres |
| POST | `/api/team` | `users.manage` | Ajouter un membre (rôle strictement inférieur au sien, sauf propriétaire) |
| PATCH | `/api/team/{membershipId}` | `users.manage` | Rôle, établissement, statut, nom |
| POST | `/api/team/{membershipId}/password` | `users.manage` | Nouveau mot de passe (refusé pour un compte partagé) |
| GET | `/api/audit?limit&before` | `audit.read` | Journal d'audit |
| GET | `/api/platform/tenants` | SUPER_ADMIN | Organisations clientes (**404** pour les autres) |
| POST | `/api/platform/tenants/{id}/suspend` · `/reactivate` | SUPER_ADMIN | Suspension effective immédiatement |

## Routes de la phase 2 — établissements et plan de salle

Un membre rattaché à un seul établissement ne voit que celui-là (les autres répondent 404).

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations?includeArchived=` | `location.read` | Établissements visibles |
| POST | `/api/locations` | `location.manage` | Créer (refusé à un membre rattaché à un établissement) |
| PATCH | `/api/locations/{id}` | `location.manage` | Modifier, dont le mode `CLOUD`/`HYBRID` (un serveur local ne repasse jamais en Cloud) |
| POST | `/api/locations/{id}/archive` · `/restore` | `location.manage` | Jamais le dernier actif ; jamais s'il reste des membres rattachés à lui seul |
| GET | `/api/locations/{id}/floor` | `tables.read` | Zones et tables actives |
| POST | `/api/locations/{id}/zones` | `tables.manage` | Créer une zone (plan de 24 × 16 cases par défaut) |
| PATCH | `/api/zones/{id}` | `tables.manage` | Renommer, réordonner, redimensionner (réduction refusée si des tables sortiraient : `details.tables`) |
| POST | `/api/zones/{id}/archive` | `tables.manage` | Seulement une zone vide |
| PUT | `/api/zones/{id}/layout` | `tables.manage` | Disposition **tout ou rien** ; conflit → 409 avec `details.overlaps` et `details.outOfBounds` (libellés) |
| POST | `/api/zones/{id}/tables` | `tables.manage` | Ajouter ; sans `x`/`y`, placée à la première place libre avec une allée |
| PATCH | `/api/tables/{id}` | `tables.manage` | Libellé, places, forme, changement de zone (place libre trouvée) |
| POST | `/api/tables/{id}/archive` | `tables.manage` | Archiver (le libellé redevient disponible) |

Le plan est une **grille de cases entières** : `x`, `y` (coin haut-gauche), `w`, `h`. Deux tables qui
se touchent ne se chevauchent pas. Les règles (`findLayoutIssues`, `findFreeSpot`) sont dans
`packages/core/src/floor.ts`, partagées par le serveur et la tablette.

## Routes de la phase 3 — menu, photos, QR

Chaque route de modification renvoie **le menu complet à jour** (`adminMenuSchema`) : l'écran n'a
qu'une source de vérité.

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/menu` | `menu.read` | Catégories, produits (versions, groupes liés), groupes d'options |
| POST | `/api/locations/{id}/categories` | `menu.manage` | Créer une catégorie (visible ou masquée) |
| PUT | `/api/locations/{id}/categories/order` | `menu.manage` | Nouvel ordre (liste complète exigée) |
| PATCH | `/api/categories/{id}` | `menu.manage` | Renommer, masquer |
| POST | `/api/categories/{id}/archive` | `menu.manage` | Seulement une catégorie vide |
| PUT | `/api/categories/{id}/products/order` | `menu.manage` | Ordre des produits |
| POST | `/api/categories/{id}/products` | `menu.manage` | Produit avec versions, groupes d'options, allergènes, étiquettes, photo |
| PATCH | `/api/products/{id}` | `menu.manage` | Champs transmis seulement ; `variants` et `modifierGroupIds` **remplacent** la liste (id connu → mis à jour, sans id → créé, absent → archivé) |
| POST | `/api/products/{id}/archive` | `menu.manage` | Archiver |
| POST | `/api/products/{id}/availability` | `menu.availability` | Épuisé / disponible (gérant, caisse, cuisine, bar) |
| POST | `/api/locations/{id}/modifier-groups` | `menu.manage` | Groupe (min/max de choix) et ses options |
| PATCH | `/api/modifier-groups/{id}` | `menu.manage` | Idem, options remplacées si transmises |
| POST | `/api/modifier-groups/{id}/archive` | `menu.manage` | Refusé tant qu'un produit l'utilise (`details.products`) |
| POST | `/api/modifiers/{id}/availability` | `menu.availability` | Option épuisée / disponible |
| POST | `/api/locations/{id}/media` | `menu.manage` | Photo **déjà compressée par l'appareil**, en base64 (JPEG, PNG, WebP ; 800 Ko max). Le serveur vérifie la signature et les dimensions du fichier, pas le type annoncé |
| GET | `/api/media/{id}` | public | Photo, cache d'un an (`immutable`, ETag), lisible depuis une autre origine |
| GET | `/api/locations/{id}/qr-codes` | `tables.read` | QR actifs des tables, avec leur adresse |
| POST | `/api/tables/{id}/qr/regenerate` | `tables.manage` | Nouveau jeton ; l'ancien cesse aussitôt de fonctionner |
| GET | `/api/public/menu/{jeton}` | public | Menu client : établissement, table, catégories visibles, produits (épuisés signalés), versions, options. 404 si QR révoqué, table ou établissement archivé, organisation suspendue |

Le **calcul du prix d'une ligne** (`priceLine`, `packages/core/src/menu.ts`) applique : prix promo sinon
prix, plus version, plus options ; refuse version manquante, option d'un autre produit, choix hors
min/max, article ou option épuisé, quantité hors 1-99. Il servira à chaque commande (phase 4-5).

## Routes des phases 4-5 — commandes

### Côté client (sans compte, depuis le QR)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/public/menu/{jeton}/orders` | Commander : `clientToken` (identifiant aléatoire du téléphone), lignes `{productId, variantId, modifierIds, quantity, note}`, remarque. **Aucun prix n'est accepté** : tout est recalculé par `priceLine` depuis le menu du moment. La commande arrive `PENDING`. 409 avec le message du premier article invalide ; 429 au-delà de 5 commandes par minute d'un même téléphone dans l'établissement, ou de 10 commandes en attente sur la table ; **503** si l'établissement est exploité par un serveur local muet depuis 20 s (SYNC.md §6) |
| GET | `/api/public/menu/{jeton}/orders?clientToken=` | Suivi : commandes de ce téléphone sur cette table (12 dernières heures) |
| POST | `/api/public/menu/{jeton}/requests` | `CALL_WAITER`, `BILL`, `HELP` ; une demande déjà ouverte n'est pas dupliquée |

### Côté personnel

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/orders?view=active\|today` | `orders.read` | Commandes en cours, ou de la journée d'exploitation |
| GET | `/api/locations/{id}/activity?since=` | `orders.read` | **Flux d'activité** : `since=0` → listes complètes et curseur ; ensuite seulement les commandes et appels modifiés après le curseur |
| POST | `/api/orders/{id}/status` | selon la transition | `CONFIRMED`/`SERVED` : `orders.create` ; `PREPARING`/`READY` : `kitchen.use`, `bar.use` ou `orders.create` ; `COMPLETED` : `payments.collect` ; `CANCELLED` : `orders.create` si la commande est en attente, sinon `orders.cancel` **avec motif** (tracé). Transition impossible → 409 ; deux gestes simultanés → le second reçoit 409 |
| GET | `/api/locations/{id}/requests` | `orders.read` | Appels ouverts |
| POST | `/api/requests/{id}/resolve` | `orders.create` | Appel traité |
| POST | `/api/table-sessions/{id}/close` | `orders.create` | Libérer la table ; refusé tant qu'une commande est en cours |

Cycle d'une commande : `PENDING → CONFIRMED → PREPARING → READY → SERVED → COMPLETED`, annulation
possible jusqu'à `READY`. Le numéro repart à 1 à chaque **journée d'exploitation** (fuseau et heure
de bascule de l'établissement) et reste unique même avec deux tablettes au même instant.

## Routes de la phase 6 — caisse

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| POST | `/api/locations/{id}/orders` | `orders.create` | Commande saisie par le personnel : `serviceType` (`DINE_IN`, `TAKEAWAY`, `DELIVERY`), `tableId` facultatif, `customerName`, lignes, remarque. **Confirmée d'emblée**, prix recalculés, catégories masquées au client vendables. Origine `POS`, ou `WAITER` pour un serveur |
| POST | `/api/orders/{id}/discount` | `orders.discount` | `{kind: PERCENT\|AMOUNT, value, reason}` ; motif obligatoire, `value: 0` retire la remise ; refusé après un paiement ; tracé `order.discount` |
| GET | `/api/locations/{id}/checks` | `orders.read` | **Notes à encaisser** : tables occupées (toutes leurs commandes) et commandes sans table ou restées impayées ; total, payé, reste |
| POST | `/api/locations/{id}/payments` | `payments.collect` | `{target: {kind: session\|order, id}, method: CASH\|MOBILE_MONEY\|CARD\|OTHER, amount, tendered?, provider?, reference?}` → **reçu**. Caisse ouverte exigée (409 sinon) ; montant ≤ reste (409) ; espèces : `tendered ≥ amount` (400). Réparti sur les commandes, la plus ancienne d'abord |
| GET | `/api/payments/{id}/receipt` | `payments.collect` | Reçu (établissement, caissier, commandes, paiement, reste) |
| POST | `/api/payments/{id}/void` | `payments.refund` | Annuler un paiement de la caisse encore ouverte, motif obligatoire ; les commandes redeviennent à encaisser ; tracé `payment.voided` |
| GET | `/api/locations/{id}/cash-session` | `payments.collect` | Caisse ouverte avec son rapport X en direct, ou `null` |
| POST | `/api/locations/{id}/cash-sessions` | `payments.collect` | Ouvrir avec `openingFloat` ; une seule caisse ouverte par établissement (409) |
| GET | `/api/locations/{id}/cash-sessions` | `payments.collect` | Historique (60 dernières) |
| GET | `/api/cash-sessions/{id}` | `payments.collect` | Détail : paiements, mouvements, résumé |
| POST | `/api/cash-sessions/{id}/movements` | `payments.collect` | Entrée/sortie d'espèces avec motif ; sortie supérieure aux espèces attendues refusée |
| POST | `/api/cash-sessions/{id}/close` | `payments.collect` | Clôture Z : `countedCash`, `note` → espèces attendues, écart, résumé figé |
| POST | `/api/table-sessions/{id}/transfer` | `orders.create` | Changer de table ; vers une table occupée, les additions sont **regroupées** |

Règles transverses :
- une commande ne passe à `COMPLETED` que **payée** (409 sinon) ;
- servie et payée, elle se termine seule ;
- une commande avec un paiement ne s'annule pas : annuler d'abord le paiement ;
- une table dont toutes les commandes sont terminées et payées, ou annulées, **se libère seule**.

Espèces attendues = fond + ventes en espèces + entrées − sorties.

## Routes des §47-48 — taxes et promotions

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/pricing` | `menu.read` | Configuration : `taxMode` (`INCLUSIVE` par défaut, `EXCLUSIVE`), `defaultTaxRateId`, taux (avec `isDefault`, `overrides`), promotions (avec `usesCount`), catégories et produits avec leur `taxRateId` propre |
| PATCH | `/api/locations/{id}/pricing` | `menu.manage` | `{taxMode?, defaultTaxRateId?}` ; tracé `pricing.settings_updated` |
| POST | `/api/locations/{id}/tax-rates` | `menu.manage` | `{name, rateBp, isDefault?}` — taux en **points de base** (1800 = 18 %) ; nom unique (409) ; tracé `pricing.tax_rate_created` |
| PATCH | `/api/tax-rates/{id}` | `menu.manage` | Nom, taux, `isDefault` ; les commandes passées gardent l'ancien taux ; tracé `pricing.tax_rate_updated` |
| POST | `/api/tax-rates/{id}/archive` | `menu.manage` | Refusé (409) pour le taux par défaut ou un taux encore cité par une catégorie ou un produit |
| PUT | `/api/categories/{id}/tax-rate` | `menu.manage` | `{taxRateId \| null}` ; null : taux par défaut ; tracé `pricing.tax_override` |
| PUT | `/api/products/{id}/tax-rate` | `menu.manage` | `{taxRateId \| null}` ; null : taux de la catégorie |
| POST | `/api/locations/{id}/promotions` | `menu.manage` | Créer (voir règles) ; code déjà pris (409) ; cible hors de l'établissement (404) ; tracé `pricing.promotion_created` |
| PUT | `/api/promotions/{id}` | `menu.manage` | Remplacer les règles ; tracé `pricing.promotion_updated` (avant / après) |
| POST | `/api/promotions/{id}/active` | `menu.manage` | `{isActive}` : suspendre ou reprendre |
| POST | `/api/promotions/{id}/archive` | `menu.manage` | Ne s'applique plus, son code se libère ; les commandes passées la gardent |
| POST | `/api/locations/{id}/orders/quote` | `orders.create` | `{lines, promoCode?}` → ticket calculé (lignes, promotions, taxes, total) sans rien enregistrer |
| POST | `/api/locations/{id}/promo-codes/check` | `orders.create` | `{code}` → règle du code (casse indifférente) ; 409 si inconnu, suspendu, hors calendrier ou épuisé |
| GET | `/api/public/menu/{jeton}/pricing` | — | Menu client : mode de taxe, taux, taux résolu et catégorie de chaque produit visible, promotions automatiques non terminées (jamais les codes) |
| POST | `/api/public/menu/{jeton}/promo-code` | — | Vérifier le code du panier (30 essais / 10 min par table) |
| POST | `/api/public/menu/{jeton}/quote` | — | Devis du panier, même calcul que la commande |

Les commandes (`POST /locations/{id}/orders`, `POST /public/menu/{jeton}/orders`) acceptent
`promoCode`. Un code inconnu, suspendu, hors calendrier, épuisé, sous le montant minimal ou sans
article visé refuse la commande (409, message pour l'utilisateur). Commandes, notes, reçus et flux
d'activité portent `subtotal`, `promotionDiscount`, `promotions[]` (`{id, name, code, amount}`),
`promoCode`, `discount` (remise manuelle), `taxMode`, `taxTotal`, `taxes[]`
(`{rateId, name, rateBp, base, tax}`), `total` ; chaque ligne porte `promotionName` et
`promotionDiscount`.

Règles (calcul unique dans `packages/core/src/taxes.ts` et `promotions.ts`, rejoué par le serveur) :
- **genres** : `PERCENT` (`value` en points de base), `AMOUNT` (par article, ou sur la commande),
  `FREE_ITEM` (`buyQuantity` achetés + `freeQuantity` offerts, par ligne, produit ou catégorie) ;
- **portée** : `ORDER` (`minAmount` facultatif), `CATEGORY` ou `PRODUCT` (`targetId`) ;
- **calendrier** dans le fuseau de l'établissement : `startDate`/`endDate` incluses, `days` (1 = lundi),
  `startMinute`/`endMinute` (happy hour ; une plage qui passe minuit compte pour la veille) ;
- **cumul**, dans l'ordre, chaque étape sur le reste : une promotion automatique par ligne (la plus
  avantageuse, à égalité la plus ancienne), code visant des lignes, meilleure promotion automatique de
  commande, code visant la commande, remise manuelle, puis taxes. Un produit à prix promotionnel ne
  reçoit pas de promotion de ligne. Un seul code par commande ;
- **utilisations** : commandes non annulées qui en ont bénéficié ; `maxUses` revérifié dans la
  transaction (ligne verrouillée en PostgreSQL) ; annuler ou refuser la commande rend l'utilisation ;
- **taxes** : taux du produit, sinon de sa catégorie, sinon par défaut ; TVA incluse = extraite du
  total, hors taxe = ajoutée ; arrondi au plus proche (demi-unité vers le haut) **une fois par taux**
  sur la somme des lignes ; remises de commande réparties au prorata des lignes ;
- **historique** : taux, promotions et montants sont copiés sur la commande ; une remise manuelle
  ultérieure recalcule les taxes avec ces taux figés.

## Routes de la phase 7 — postes et écran cuisine

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/stations` | `menu.read` | Postes actifs (nom, type `KITCHEN`/`BAR`, nombre de produits) ; aussi dans `GET /locations/{id}/menu` (`stations`) |
| POST | `/api/locations/{id}/stations` | `menu.manage` | Créer un poste (Grill, Pâtisserie, Bar terrasse…) |
| PATCH | `/api/stations/{id}` | `menu.manage` | Renommer, changer le type ou l'ordre |
| POST | `/api/stations/{id}/archive` | `menu.manage` | Refusé (409, produits listés) tant que des produits y sont affectés |
| POST | `/api/orders/{id}/kitchen` | `kitchen.use` / `bar.use` selon les postes touchés | `{stationId \| null, action: START \| READY \| RECALL}`. Avance les articles du poste (tous si `null`) ; la commande passe « en préparation » au premier article commencé, « prête » quand tous les articles le sont. 409 : commande en attente de confirmation, déjà servie, sans article pour ce poste, ou rappel d'une commande déjà annoncée prête |

Les produits portent `stationId` (null : premier poste Cuisine). Chaque article de commande copie
son poste (`items[].stationId`) et son avancement (`items[].kdsStatus` : `QUEUED`, `PREPARING`,
`READY`), visibles dans le flux d'activité. Tout nouvel établissement reçoit les postes « Cuisine »
et « Bar ». Annoncer une commande « prête » depuis l'écran Commandes marque tous ses articles prêts.

## Routes des phases 11 et 14 — serveur local et rapports

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/health` | — | En profil `local`, ajoute `lanUrls` : adresses à saisir sur les tablettes (`http://192.168.1.20:7300`) |
| GET | `/*` (hors `/api`) | — | Serveur local lancé avec `AFK_WEB_DIR` : application web (`assets/` en cache définitif, pages sans cache), `/m/{jeton}` → menu client, toute autre adresse sans extension → `index.html` ; jamais de fichier hors du dossier |
| GET | `/api/locations/{id}/reports/sales?from=AAAA-MM-JJ&to=AAAA-MM-JJ` | `reports.read` | Ventes par **journée d'exploitation** (366 jours au plus) : `totals` (chiffre d'affaires, encaissé, commandes, ticket moyen, articles, remises, annulées), `byDay` (tous les jours de la période), `byMethod`, `byHour` (fuseau de l'établissement), `bySource`, `byServiceType`, `topProducts` (15), `byTax` (base et taxe par taux), `byPromotion` (commandes et remise par promotion) ; `totals` porte aussi `promotions`, `taxCollected`, `revenueExclTax`. Chiffre d'affaires = commandes confirmées non annulées ; les commandes QR encore en attente n'y entrent pas |

## Routes de la phase 13 — stock et recettes

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/inventory` | `inventory.read` | Articles : niveau (somme des mouvements), seuil, coût unitaire, valeur, état `OK/LOW/OUT`, nombre de recettes |
| POST | `/api/locations/{id}/inventory` | `inventory.manage` | Créer : nom, unité (`PIECE, PORTION, KG, G, L, CL, ML`), seuil, coût |
| PATCH | `/api/inventory/{id}` | `inventory.manage` | Modifier |
| POST | `/api/inventory/{id}/archive` | `inventory.manage` | Refusé (409, produits listés) s'il entre dans une recette |
| POST | `/api/inventory/{id}/movements` | `inventory.manage` | `IN` (réception, coût facultatif qui devient le coût de référence), `OUT` et `LOSS` (motif obligatoire, jamais au-delà du stock), `COUNT` (quantité comptée : l'écart est enregistré). Quantités décimales, 3 décimales au plus |
| GET | `/api/inventory/{id}/movements` | `inventory.read` | 100 derniers mouvements (dont ventes `SALE` et `SALE_CANCEL` avec n° de commande) |
| GET / PUT | `/api/products/{id}/recipe` | `inventory.read` / `inventory.manage` | Recette : `{itemId, variantId \| null, quantity}` ; `variantId: null` = toutes versions |

Effets sur les commandes :
- **Confirmation** d'une commande (saisie en caisse ou par un serveur, ou QR confirmé) : déduction des recettes (`SALE`), une seule fois.
- **Annulation après confirmation** : restitution (`SALE_CANCEL`).
- **Ingrédient insuffisant pour une portion** : le plat passe épuisé avec le motif `STOCK` (journal `menu.stock_out`). Il redevient disponible au réapprovisionnement (`menu.stock_back`), sauf si quelqu'un l'a épuisé à la main.

## Routes de la phase 9 — impression

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/printers` | `orders.read` | Imprimantes : adresse, papier (48 = 80 mm, 32 = 58 mm), poste, tickets et/ou reçus, dernier état |
| POST / PATCH | `/api/locations/{id}/printers`, `/api/printers/{id}` | `devices.manage` | Créer, modifier ; adresse IP ou nom sans `http://` |
| POST | `/api/printers/{id}/archive` | `devices.manage` | Retirer ; ses travaux en attente passent en échec |
| POST | `/api/printers/{id}/test` | `devices.manage` | Ticket de test envoyé immédiatement ; résultat dans `lastOkAt` / `lastError` |
| GET | `/api/locations/{id}/print-jobs` | `devices.manage` | 50 derniers travaux (`PENDING/SENT/FAILED`, tentatives, erreur, n° de commande) |
| POST | `/api/print-jobs/{id}/retry` | `devices.manage` | Relancer un travail en échec |
| POST | `/api/payments/{id}/print` | `payments.collect` | Reçu vers les imprimantes de reçus ; 409 s'il n'y en a pas |

Chaque **confirmation** de commande met en file un ticket par imprimante de préparation concernée :
celle du poste de ses articles, ou celle qui imprime tous les postes. Une commande confirmée deux
fois n'est pas réimprimée. La file est vidée par le **serveur local** toutes les 1,5 s :
- trois tentatives, espacées de 5 s puis 10 s ;
- ensuite, échec visible et relançable ;
- une imprimante en panne ne bloque jamais une vente.

Le texte part en ESC/POS, page de codes 850 (accents français).

## Routes de la phase 12 — synchronisation

Cloud :

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| POST | `/api/locations/{id}/pairing-code` | `location.manage` | Code d'appairage `XXXX-XXXX` (usage unique, 10 min) |
| POST | `/api/sync/pair` | code | `{code, deviceName}` → identité et secret de l'appareil, copie initiale, curseur ; l'établissement passe en `HYBRID` |
| POST | `/api/sync/push` | appareil (`x-afk-device`, `x-afk-device-secret`) | Jusqu'à 500 événements ; résultat par événement `APPLIED/DUPLICATE/CONFLICT/REJECTED` ; identifiants mal formés → 400 |
| GET | `/api/sync/pull?since=` | appareil | Événements des autres nœuds pour cet établissement, curseur suivant |

Serveur local :

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/api/health` | — | `configured` : false tant qu'aucun restaurant n'est créé ni relié |
| POST | `/api/system/sync/pair` | serveur neuf | `{cloudUrl, code}` → 201 `{organization, location}` ; 403 si déjà configuré |
| GET | `/api/system/sync` | `settings.manage` | Relié, adresse, dernier envoi / réception, en attente, à revoir, dernière erreur |
| POST | `/api/system/sync/now` | `settings.manage` | Synchroniser tout de suite : `{pushed, pulled, conflicts, status}` |

## Routes de la phase 17 — abonnements et serveurs reliés

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/api/tenant` | `tenant.read` | Ajoute `subscription` : offre, état `TRIAL/ACTIVE/GRACE/EXPIRED`, échéance, jours restants, limites, utilisation |
| POST | `/api/platform/tenants/{id}/subscription` | back-office | `{plan, months, unlimited}` : change l'offre ; les mois s'ajoutent à l'échéance restante, jamais à une date passée |
| GET | `/api/locations/{id}/devices` | `location.manage` (Cloud) | Serveurs locaux reliés : nom, état, relié le, dernier contact |
| POST | `/api/devices/{id}/revoke` | `location.manage` (Cloud) | 204 ; secret effacé ; sans serveur restant, l'établissement repasse en `CLOUD` |

Au-delà de l'offre, ou une fois l'abonnement échu depuis plus de 7 jours : **402 `PLAN_LIMIT`** sur
la création d'établissement, l'ajout de membre et le code d'appairage (`details` : `resource`,
`limit`, `used`). Rien d'autre n'est jamais bloqué. `me.tenant.planExpiresAt` sert au rappel
d'échéance. Le serveur local ne contrôle aucune limite.

## Routes des §70-71 — assistant de mise en route et démonstration

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/setup` | `location.read` | Avancement calculé depuis les données : compteurs (zones, tables, catégories, produits, postes, membres, imprimantes, caisses, commandes), `hasLogo`, `hasAddress`, `testDone`, `isDemo`, `started`, `completedAt`, `steps[]` (`id`, `label`, `done`, `skipped`) et `nextStep` (où reprendre ; null quand tout est fait ou passé) |
| POST | `/api/locations/{id}/setup/steps/{step}` | `location.manage` | `{skipped}` : passer une étape (`true`) ou la reprendre (`false`). Valider `restaurant` démarre l'assistant. Étapes : `restaurant, logo, address, currency, categories, products, tables, qr, stations, users, printers, test` |
| POST | `/api/locations/{id}/setup/finish` | `location.manage` | Termine l'assistant ; 409 tant qu'une étape n'est ni faite ni passée |
| POST | `/api/locations/{id}/setup/tables` | `tables.manage` | `{zones: [{name, count 1-60, capacity, shape?, prefix?}]}` (1 à 6 zones) → 201 plan de salle. Zone nouvelle : plan en rangées avec allées ; zone existante (même nom) : places libres. Libellés T1…, TE1… sans doublon ; chaque table reçoit son QR |
| POST | `/api/locations/{id}/setup/test-order` | `location.manage` | 201 `{order, stations}` : vraie commande (à emporter) du premier produit disponible, options obligatoires remplies ; `stations` = postes qui l'ont reçue. 409 sans produit |
| POST | `/api/locations/{id}/setup/test-order/{orderId}/finish` | `location.manage` | Annule la commande de test (motif « Commande de test de la mise en route », journal `order.cancelled`) et valide l'étape. 404 pour toute commande qui n'a pas été créée par le test |
| POST | `/api/locations/{id}/demo` | `menu.manage` + `tables.manage` | Établissement vide, une fois par organisation (sinon 409). 201 = avancement + `staff[]`. Organisation ordinaire : 20 tables, postes, carte avec photos, `staff` vide. Organisation `is_demo` (propriétaire ou administrateur) : en plus l'équipe (mots de passe générés, rendus une seule fois), 14 jours d'historique et le service du jour |
| POST | `/api/platform/demo-tenants` | back-office (Cloud) | `{email?}` → 201 `{tenantId, locationId, organizationName, owner, staff, status}` : nouvelle organisation « AfriKaisse Demo Restaurant » marquée `is_demo`, sans échéance |

`PATCH /api/locations/{id}` accepte `logoMediaId` (image téléversée par `POST /api/locations/{id}/media`,
de la même organisation, sinon 404 ; `null` retire le logo). `logoUrl` est ajouté à la fiche de
l'établissement, au reçu (`location.logoUrl`), à la liste des QR (`logoUrl`) et au menu public
(`restaurant.logoUrl`).

Commande d'exploitation : `node dist/cli.cjs create-demo [e-mail]` crée la même organisation de
démonstration et affiche les identifiants une seule fois.

## Rapports détaillés et temps de préparation (§30, §38-39)

Toutes les périodes sont des **journées d'exploitation** (`from`, `to` au format AAAA-MM-JJ, 366 jours au plus). Une vente = commande confirmée non annulée.

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/reports/breakdown?from&to` | `reports.read` | `byWeek` (semaines ISO, clé = lundi) et `byMonth` (AAAA-MM), `products` (tous, avec la catégorie actuelle du produit), `categories`, `staff` (commande attribuée à qui l'a saisie, sinon à qui l'a confirmée ; encaissements par auteur du paiement), `payments` (`byMethod`, `byDay` par mode, `voidedCount`, `voidedAmount`) |
| GET | `/api/locations/{id}/reports/kitchen?from&to` | `reports.read` | Temps de préparation : `totals` (commandes mesurées, moyenne, médiane, plus long, en retard, retard moyen, articles mesurés), `byStation`, `byProduct` (portions, moyenne, prévu, en retard), `byDay`, `lateTickets` (50 plus gros retards). Durées en millisecondes |
| GET | `/api/locations/{id}/reports/stock?from&to` | `inventory.read` | Par article : début, reçu, consommé (ventes nettes des annulations), pertes, sorties, ajustements d'inventaire (signés), fin ; valeurs au coût unitaire actuel (réceptions : coût saisi) ; `events` = pertes, sorties et inventaires (200 derniers) |

**Calcul des durées** (`packages/core/src/prep.ts`) :
- durée d'une commande = premier passage `CONFIRMED` → premier passage `READY` dans `order_status_history` (à défaut, le dernier article prêt) ;
- durée d'un article = confirmation → `order_items.kds_updated_at` quand `kds_status = READY` (dernier « prêt » de son poste) ;
- temps prévu d'un article = `products.prep_time_min` (15 min si vide, 1 min au moins) ; d'une commande = le plus long de ses articles ;
- retard = durée − temps prévu, s'il est positif. Les articles marqués prêts avant la phase 7 (sans heure) ne sont pas mesurés.

Les écrans exportent chaque rapport en **CSV** (Excel français : point-virgule, BOM UTF-8, virgule décimale) et l'impriment en **A4** (PDF via l'impression du navigateur ; masqué dans l'application tablette).

## Notifications (§42)

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/notifications?since=` | connecté à l'organisation | `{ cursor, full, unread, items }` : notifications de l'établissement dont le public est une permission du rôle, sauf celles dont on est l'auteur, sur 3 jours (50 au plus). `since=0` (ou curseur inconnu) : liste complète ; sinon seulement les nouvelles. `items[]` : id, seq, kind, urgent, title, body, data, entityType, entityId, createdAt, read |
| POST | `/api/notifications/{id}/read` | public de la notification | 204 ; 404 hors organisation, hors établissement ou hors public |
| POST | `/api/locations/{id}/notifications/read-all` | connecté | Corps `{ upTo? }` (curseur affiché) → `{ unread }` ; purge les notifications de plus de 30 jours |
| POST | `/api/orders/{id}/kitchen/problem` | `kitchen.use` / `bar.use` selon les postes touchés | Corps `{ stationId: uuid ou null, message }` → 204, notification `KITCHEN_PROBLEM` + audit `kitchen.problem` ; 409 si la commande n'est pas en cuisine |

| Type | Écrit quand | Public | Urgent |
|---|---|---|---|
| `ORDER_NEW` | commande QR reçue (en attente) | `orders.create` | oui |
| `ORDER_READY` | commande passée « prête » (écran cuisine ou Commandes) | `orders.create` | oui |
| `WAITER_CALL` | appel d'un serveur ou demande d'aide depuis le QR | `orders.create` | oui |
| `BILL_REQUESTED` | addition demandée depuis le QR | `orders.create` | oui |
| `KITCHEN_PROBLEM` | problème signalé depuis l'écran cuisine | `orders.create` | oui |
| `STOCK_LOW` | un article franchit son seuil (faible) ou tombe à zéro (rupture), par un mouvement ou une vente | `inventory.read` | non |

Chaque notification est écrite **dans la transaction** de l'événement qui la cause (`services/api/src/lib/notify.ts`) ; `dedupe_key` + `ON CONFLICT DO NOTHING` empêchent les doublons. Le texte (`title`, `body`) est calculé à la lecture depuis `data` (`notificationText` du cœur).

## Phase 18 — limites par adresse IP

Routes `POST` ouvertes sans connexion : 429 `TOO_MANY_ATTEMPTS` et en-tête `Retry-After` au-delà de
la limite (valeurs dans SECURITY.md). `AFK_RATE_LIMIT=false` les désactive (tests).

## §67 — back-office GLOBALTECH (Cloud)

Toutes les routes : `is_platform_admin`, contrôlé avant la validation. Client connecté : **404**
partout (même identifiant mal formé) ; anonyme : 401. Absentes du serveur local.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/platform/restaurants?q=` | Organisations : offre, état d'abonnement, échéance, membres, dernière activité ; leurs établissements (mode, état, devise, dernière activité) |
| GET | `/api/platform/users?q=&limit=` | Comptes de toutes les organisations (nom ou e-mail), dernière connexion, organisations et rôles |
| POST | `/api/platform/users/{id}/suspend` · `/reactivate` | 204 ; suspension : sessions révoquées, changement synchronisé, audit ; 409 sur son propre compte ou un compte back-office |
| GET | `/api/platform/devices` | Installations : type, organisation, établissement, version, dernier contact, état (révoqué) |
| GET | `/api/platform/sync` | Par serveur local : derniers envoi et réception, en attente / en échec / en conflit annoncés, conflits gardés par le Cloud |
| GET | `/api/platform/errors?limit=&before=` | Erreurs 500 : date, identifiant de requête, méthode, motif de route, code, message nettoyé, organisation |
| GET | `/api/platform/stats` | Organisations, établissements actifs et hybrides, comptes, serveurs locaux ; sur 7 et 30 jours par devise : commandes, chiffre d'affaires, encaissé (démos exclues) |

Existantes : `GET /api/platform/tenants`, `POST /api/platform/tenants/{id}/subscription`,
`/suspend`, `/reactivate`.

Toute réponse 500 porte `details.requestId`, le même identifiant que la ligne du journal d'erreurs.

## §68-69 — supervision

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/api/locations/{id}/monitoring` | `devices.manage` | `overall`, puis `api`, `database`, `cloud`, `localServer`, `sync`, `printers`, `kds`, `backup` ; chaque bloc a un `state` `OK/WARN/ERROR/NONE` |
| POST | `/api/locations/{id}/screens/heartbeat` | `orders.read` | `{screenId, stationId?, name?}` → 204 ; appelé toutes les 30 s par l'écran Cuisine |

Le serveur local ajoute à chaque push et pull : `x-afk-version`, `x-afk-pending`, `x-afk-failed`,
`x-afk-conflicts` ; le Cloud les range dans `devices` (valeurs mal formées ignorées).

## §73 — mises à jour

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/api/public/releases/latest?channel=stable` | public | Plus haute version du canal (semver) : `{channel, version, releasedAt, notes, downloadUrl, sha256, signature}` ; 404 si aucune ; cache 5 min |
| GET | `/api/system/update` | `settings.manage` | `{enabled, currentVersion, channel, latest, updateAvailable, lastCheckAt, lastError}` (dernière annonce **vérifiée**) |
| POST | `/api/system/update/check` | `settings.manage` | Serveur local : recherche immédiate ; 409 dans le Cloud. N'installe rien |

Signature : Ed25519 sur `JSON.stringify(["afrikaisse-release-v1", channel, version, releasedAt, notes, downloadUrl, sha256])`.
Publication : `cli release-sign` puis `cli release-publish` (DEPLOYMENT.md §4.1).

## Temps réel (phases 5-8)

- **En place (phase 5)** : le flux d'activité `GET /api/locations/{id}/activity?since=` est interrogé
  toutes les **3 s** quand l'écran est visible, **15 s** en arrière-plan, **6 s** après une erreur
  réseau. Le journal de synchronisation sert de flux de changements (index `location_id, seq`) :
  aucune file ni processus permanent, donc compatible o2switch, serveur local, tablette native et
  vieille WebView. Un seul flux pour toute l'application (pastille de l'onglet Commandes, signal
  sonore sur n'importe quel écran).
- **Notifications (§42)** : `GET /api/locations/{id}/notifications?since=` suit le même principe (5 s à l'écran, 20 s en arrière-plan), curseur = `notifications.seq` local.
- **Optimisation possible ensuite** : SSE sur le serveur local, et dans le Cloud si la sonde o2switch
  confirme qu'il n'est pas bufferisé. Pas de WebSocket (ADR-010).

## Groupes de routes à venir

`/api/menu` · `/api/categories` · `/api/products` ·
`/api/modifiers` · `/api/qr/{token}` (public) · `/api/orders` · `/api/kitchen` · `/api/stations` ·
`/api/payments` · `/api/cash-sessions` · `/api/inventory` · `/api/reports` · `/api/sync` ·
`/api/devices` · `/api/stream`.
