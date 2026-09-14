# AfriKaisse — Synchronisation Local ↔ Cloud

> État : **livrée en phase 12**. Le journal (outbox) est écrit depuis la phase 1 ; le transport
> (appairage, push, pull) est dans `services/api/src/services/sync/` (`apply.ts` commun,
> `server.ts` côté Cloud, `client.ts` côté serveur local). Voir « Ce qui est en place » en fin de
> document pour l'écart avec la cible décrite ci-dessous.

## 1. Principes

1. **Le serveur local pilote.** Il ouvre toutes les connexions (HTTPS sortant). Le Cloud ne contacte
   jamais le LAN : NAT, 4G et CGNAT l'en empêchent (ADR-009).
2. **Outbox transactionnelle.** Toute modification de donnée synchronisée écrit sa ligne dans
   `sync_events` **dans la même transaction**. Une modification sans événement est impossible, et
   l'inverse aussi (`services/api/src/lib/journal.ts → recordChange`).
3. **Idempotence par `event_id`.** Recevoir deux fois le même événement ne change rien : index unique
   côté récepteur, réponse `DUPLICATE`.
4. **Une autorité opérationnelle par établissement** (ADR-004). Elle seule numérote les commandes,
   crée les tickets cuisine et encaisse.
5. **Les transactions ne sont jamais écrasées.** Une commande confirmée évolue par ajout
   d'événements (`order_status_history`), jamais par un UPDATE destructif reçu du réseau (§55).
6. **HLC partout.** L'ordre ne dépend pas de l'horloge murale des PC.

## 2. Événement

| Champ | Rôle |
|---|---|
| `event_id` | UUID v7, identité et clé d'idempotence |
| `seq` | Curseur local d'écriture (ordre d'envoi) |
| `device_id` | Nœud émetteur |
| `tenant_id`, `location_id` | Portée ; le Cloud refuse un événement hors du tenant de l'appareil |
| `entity_type`, `entity_id` | Entité concernée |
| `operation` | `UPSERT`, `DELETE` (données maîtres) ; événements métier nommés pour les transactions (`ORDER_PLACED`, `ORDER_STATUS_CHANGED`, `PAYMENT_RECORDED`, `ITEM_VOIDED`…) |
| `payload` | Instantané de la ligne (maîtres) ou données de l'événement (transactions) |
| `hlc` | Horodatage logique hybride |
| `status` | `PENDING → SYNCING → SYNCED`, ou `FAILED` (réessai), `CONFLICT` (revue) |
| `retry_count`, `last_error` | Réessais avec attente exponentielle plafonnée |

## 3. Push (local → Cloud)

```text
SERVEUR LOCAL                                          CLOUD
─────────────                                          ─────
boucle (toutes les 2 s si PENDING, 30 s sinon)
  lot = 200 premiers PENDING/FAILED par seq
  marquer SYNCING
  POST /api/sync/push { deviceId, events[] }  ───────► pour chaque événement, dans une transaction :
                                                          existe déjà (event_id) ? → DUPLICATE
                                                          portée tenant/appareil valide ?
                                                          appliquer selon la classe (§4)
                                                          enregistrer event_id
  ◄─────────────────────────── { results: [{eventId, APPLIED|DUPLICATE|CONFLICT|REJECTED}] }
  APPLIED/DUPLICATE → SYNCED
  CONFLICT → CONFLICT (+ sync_conflicts)
  erreur réseau → retour à PENDING, retry_count+1
```

**Reprise après crash** : au démarrage, tout `SYNCING` redevient `PENDING`. L'idempotence rend le
renvoi sans danger. Un PC éteint en pleine synchronisation ne perd ni ne duplique rien.

## 4. Application selon la classe de donnée

| Classe | Règle | Exemple |
|---|---|---|
| **Données maîtres** | Dernier écrivain gagnant **par HLC**. Si `payload.updated_hlc` ≤ HLC en base, l'événement est ignoré (`APPLIED`, sans effet) et tracé. | Le gérant change un prix hors ligne pendant qu'un admin le change dans le Cloud : le HLC le plus récent l'emporte, les deux versions restent dans l'audit. |
| **Transactions (ajout seulement)** | Insérées si absentes. Jamais modifiées par la synchronisation. | Paiement espèces enregistré pendant la coupure. |
| **Machine à états (commandes, tickets)** | L'événement de transition est ajouté à l'historique. L'état courant est **recalculé** : transitions valides, dans l'ordre HLC. Une transition impossible (ex. `CANCELLED` reçu après `SERVED`) est marquée `CONFLICT` pour revue par le gérant. | Un client annule par QR pendant que la cuisine passe en préparation. |
| **Suppressions** | Logiques (`status = ARCHIVED`) pour tout ce qui est référencé par une transaction. | Un produit retiré du menu reste lisible dans les anciennes commandes (noms et prix **copiés** dans `order_items`). |

### En place (phase 5)

| Entité | Opération | Contenu |
|---|---|---|
| `order` | `ORDER_PLACED` | La commande complète (lignes, options copiées, historique) au moment de sa création |
| `order` | `ORDER_STATUS_CHANGED` | La commande complète après la transition ; la transition elle-même est dans `order_status_history` (ajout seulement) |
| `order` | `ORDER_UPDATED` | La commande complète après une remise, un paiement ou un changement de table |
| `payment` | `PAYMENT_RECORDED` | Le paiement et sa répartition sur les commandes (ajout seulement) |
| `payment` | `PAYMENT_VOIDED` | Le paiement annulé, avec motif |
| `table_session`, `service_request`, `cash_session`, `cash_movement`, `station` | `UPSERT` | Ligne après écriture |

Côté réception, une transition est rejouée seulement si elle est valide depuis l'état connu
(`canTransition`) ; sinon l'événement est marqué `CONFLICT` pour revue.

## 5. Autorité opérationnelle et numérotation

- Mode `CLOUD` : le Cloud numérote (`order_counters` par établissement et journée d'exploitation).
- Mode `HYBRID` : le serveur local numérote, **y compris pour les commandes QR** reçues via le Cloud.
- Changer de mode est un geste d'administration tracé. Il n'est permis que sans commande ouverte.

## 6. Commandes QR d'un établissement en mode hybride

```text
Client (4G) ─► Cloud : POST commande QR
                 │  Cloud : dernier signe de vie du serveur local < 20 s ?
                 │    non → 503 « commande en ligne indisponible, appelez un serveur »   (I-1)
                 │    oui → enregistre ORDER_PLACED (PENDING, sans numéro)
Serveur local ─► Cloud : pull (long-poll ≤ durée max mesurée par la sonde)
                 │  reçoit ORDER_PLACED → attribue le numéro → KDS/impression sur le LAN
                 │  personnel confirme → ORDER_STATUS_CHANGED (CONFIRMED)
Serveur local ─► Cloud : push → le client voit « confirmée », puis « prête »
```

Le « signe de vie » est le pull lui-même. Il garde aussi l'application Passenger éveillée.

## 7. Pull (Cloud → local)

`GET /api/sync/pull?since=<curseur>` renvoie les événements du tenant **qui ne viennent pas de cet
appareil**, triés par `seq` Cloud, avec le curseur suivant. Le local les applique avec les mêmes
règles (§4) et enregistre le curseur dans `sync_cursors`. En pratique : modifications du
back-office, commandes QR, changements d'abonnement.

## 8. Premier appairage d'un serveur local

1. Le propriétaire crée l'établissement dans le Cloud, puis clique « Installer un serveur local » :
   code d'appairage à usage unique (10 min).
2. L'installateur Windows demande ce code ; le serveur local s'enregistre (`devices`, kind
   `LOCAL_SERVER`) et reçoit son identité et son secret d'appareil.
3. Instantané initial : données maîtres de l'établissement, puis flux normal.
4. Un serveur local configuré **sans** Internet (profil local, inscription locale) pourra être
   rattaché plus tard. Ses UUID rendent la fusion sans collision.

## 9. Supervision

Chaque nœud expose : événements `PENDING` (nombre, âge du plus ancien), `FAILED`, `CONFLICT`,
dernier push et pull réussis, écart d'horloge avec le Cloud. Ces valeurs alimentent l'écran d'état
(§68) et le back-office (§67).

## Ce qui est en place (phase 12)

**Appairage** (§8, sens « Cloud d'abord ») :
1. Dans le Cloud, **Établissements → Relier un serveur local** : code `XXXX-XXXX`, usage unique, 10 minutes (empreinte SHA-256 seulement en base ; au-delà de 20 échecs en 10 minutes, les essais sont bloqués).
2. Sur le PC, serveur **neuf** (aucun restaurant) : écran de connexion → **Relier à AfriKaisse Cloud** → adresse et code.
3. Le Cloud crée l'appareil `LOCAL_SERVER` et son secret (renvoyé une fois, stocké haché), passe l'établissement en `HYBRID`, et renvoie une **copie initiale** :
   - organisation, établissement, membres (mots de passe compris, droits plateforme retirés), photos ;
   - zones, tables, QR, postes, carte complète, imprimantes, stock et recettes ;
   - les **compteurs de commandes et de reçus** : un établissement relié en cours de journée continue sa numérotation au lieu de repartir de 1 (sinon doublons refusés par le Cloud) ;
   - le curseur courant.

   Avant l'appairage, **clôturer la caisse ouverte dans le Cloud** : un établissement n'a qu'une caisse ouverte, et c'est désormais celle du PC.
4. Le serveur local l'insère et retient `sync_cloud_url`, `sync_device_id`, `sync_device_secret`, `sync_location_id` et `sync_cursor` dans `node_state`.

**Boucle** (toutes les 5 s, serveur local relié) :
- **push** : les événements `PENDING` de ce nœud, par lots de 200, en-têtes `x-afk-device` / `x-afk-device-secret`. Réponses `APPLIED` / `DUPLICATE` → `SYNCED` ; `CONFLICT` / `REJECTED` → `CONFLICT` avec le motif.
- **pull** : les événements du tenant après le curseur, par pages de 500 :
  - venant d'un autre nœud, et seulement `SYNCED` ;
  - de cet établissement, ou sans établissement (organisation, comptes).
- **Idempotence** : l'`event_id` reçu est inscrit dans le `sync_events` du nœud qui reçoit. Un rejeu répond `DUPLICATE`, et un événement déjà reçu est ignoré.
- **HLC** : chaque événement reçu passe par `clock.receive`.
- **Signe de vie** : chaque appel authentifié met à jour `devices.last_seen_at` ; c'est lui qui rouvre les commandes QR en ligne (§6).
- **Hors ligne** : l'erreur est gardée dans `sync_last_error`, rien n'est perdu, et tout part au retour d'Internet.

**Application** (`apply.ts`) :

| Événement | Règle |
|---|---|
| Maîtres (tenant, location, user, membership, zone, dining_table, qr_code, carte, station, printer, inventory_item, recipe_item, table_session, service_request, cash_session) | Insertion, ou mise à jour si `updated_hlc` reçu > local ; `DELETE` supprime |
| `cash_movement`, `inventory_movement`, `media` (octets en `{ $bytes }`) | Insérés si absents, jamais réécrits |
| `order` | La charge porte les lignes brutes (`rows.order/items/modifiers/history`) : commande par HLC, lignes rejouées, options et historique ajoutés si absents |
| `payment` | `PAYMENT_RECORDED` : paiement et parts ajoutés si absents ; `PAYMENT_VOIDED` : ligne remplacée |
| Sessions de connexion, file d'impression, compteurs | Jamais synchronisés |

**Garde du Cloud** (un serveur local compromis ne sort pas de son périmètre) :
- **Périmètre** : chaque ligne doit appartenir à son organisation et à son établissement, sinon `REJECTED`.
- **Organisation** : le statut, l'offre et le mode démo ne sont pas modifiables.
- **Comptes** : jamais de droits plateforme ; pas de modification d'un compte partagé avec une autre organisation ; pas d'adresse e-mail déjà prise.

**Commandes QR d'un établissement hybride** : le Cloud les numérote à partir de **901** (compteur
`<journée>#cloud`), le serveur local garde 1, 2, 3… ; elles descendent « en attente », sont
confirmées sur place, et le client suit l'avancement en ligne.

Limites connues, à reprendre :
- une même table ouverte des deux côtés au même instant (session ouverte en double) produit un conflit gardé pour revue ;
- l'historique des ventes antérieur à l'appairage reste dans le Cloud ;
- il n'y a pas encore d'écran de revue des conflits (compteur « à revoir » dans Organisation) ;
- la révocation d'un appareil se fait depuis la base.

## 10. Tests exigés (phase 12)

- renvoi d'un lot déjà appliqué → aucun doublon ;
- coupure au milieu d'un lot (processus tué) → reprise sans perte ;
- horloge locale en retard d'une heure → ordre HLC correct ;
- prix modifié des deux côtés hors ligne → gagnant déterministe, trace d'audit des deux ;
- commande QR pendant que le local est muet → refus propre, pas de commande fantôme ;
- scénario complet du §76, internet coupé puis rétabli.
