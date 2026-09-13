# AfriKaisse — Synchronisation Local ↔ Cloud

> État : le **journal** (outbox) est écrit depuis la phase 1, dans la même transaction que chaque
> modification. Le **transport** (push/pull) est la phase 12. Ce document fixe les règles pour que
> le code écrit d'ici là les respecte.

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

## 10. Tests exigés (phase 12)

- renvoi d'un lot déjà appliqué → aucun doublon ;
- coupure au milieu d'un lot (processus tué) → reprise sans perte ;
- horloge locale en retard d'une heure → ordre HLC correct ;
- prix modifié des deux côtés hors ligne → gagnant déterministe, trace d'audit des deux ;
- commande QR pendant que le local est muet → refus propre, pas de commande fantôme ;
- scénario complet du §76, internet coupé puis rétabli.
