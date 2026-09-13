# AfriKaisse — Architecture

> Document de référence des étapes 1 à 8 du cahier des charges (§85).
> Rédigé le 13/09/2026, en même temps que la phase 1. Les décisions sont numérotées (ADR-xxx) :
> les remettre en cause, c'est modifier ce fichier, pas le contourner dans le code.

---

## 1. Analyse du cahier des charges

AfriKaisse n'est pas un menu QR : c'est le **système d'exploitation d'un restaurant**. Il est vendu
en SaaS à plusieurs organisations, et il **doit continuer à encaisser quand Internet tombe**.

Tout le cahier des charges repose sur quatre exigences :

| Exigence | Conséquence d'architecture |
|---|---|
| Une seule logique métier pour Web, mobile, desktop et local (§4) | Un **cœur métier unique** exécuté à l'identique dans le Cloud et sur le serveur local |
| Continuer sans Internet (§8, priorité n° 2) | Le serveur local est **autonome** : sa base, ses règles, son authentification |
| Plusieurs restaurants isolés sur un même serveur (§12) | `tenant_id` sur toutes les données, portée vérifiée à chaque requête |
| Synchronisation fiable, idempotente, reprise après crash (§9–11, §54–55) | Outbox transactionnelle, UUID, horloge logique hybride, événements métier jamais écrasés |

---

## 2. Incohérences et manques relevés — et décisions prises

| # | Constat | Décision |
|---|---|---|
| I-1 | **Le menu QR ne peut pas fonctionner hors ligne pour un client en 4G.** Le §76 demande une commande pendant la coupure. Or le téléphone du client passe par *son* opérateur. Il atteint le Cloud, mais pas le serveur local du restaurant, qui n'est plus joignable. | Pendant une coupure, la commande **passe par le personnel** (POS, application serveur sur le Wi-Fi local). La page QR reste consultable (cache PWA). Elle affiche « commande en ligne momentanément indisponible, appelez un serveur » dès que le Cloud ne voit plus le serveur local (voir SYNC.md §6). Le scénario §76 « internet coupé » est testé côté POS. |
| I-2 | **Ordre des phases contradictoire avec les priorités.** Le hors ligne est priorité n° 2 mais n'arrive qu'aux phases 11-12. Reprendre dix phases de code en ligne après coup coûterait très cher. | Les invariants du hors ligne sont en place **dès la phase 1** : UUID v7, outbox écrite dans la transaction, HLC, même code sur SQLite et PostgreSQL, tests sur les deux moteurs, profil `local`. Les phases 11-12 ajoutent le transport, pas les fondations. |
| I-3 | **Hiérarchie ambiguë** : `tenants`, `restaurants` **et** `locations` (§56), alors que le §14 décrit deux niveaux (Groupe → établissements). | **ADR-003** : `tenant` = organisation cliente (celle qui paie l'abonnement), `location` = établissement. Pas de table `restaurants`. Une notion de *marque* pourra s'intercaler plus tard si un groupe exploite plusieurs enseignes. |
| I-4 | **Temps réel sur o2switch** : WebSocket demandé (§58), mais inutilisable derrière Passenger. Constaté sur WIFIHUB, et o2switch dit en limiter l'usage. | Le temps réel **critique** (KDS, serveurs) passe par le **serveur local**, sur le LAN. Dans le Cloud : SSE si la sonde le valide, sinon polling intelligent. Aucune dépendance au WebSocket. |
| I-5 | **Aucun processus permanent sur un mutualisé** : la synchronisation automatique (§9), les sauvegardes (§69) et les notifications (§42) supposent des tâches de fond. | Le Cloud est **passif** : il reçoit, stocke et restitue. C'est le serveur local qui **pilote** la synchronisation (connexion sortante). Les tâches périodiques Cloud (purge, sauvegarde) passent par le **cron cPanel**. |
| I-6 | **Le Cloud ne peut pas joindre les imprimantes du restaurant** (§32) : NAT, box 4G, CGNAT. | L'agent local **tire** les travaux d'impression par une connexion sortante. Le Cloud n'appelle jamais le LAN (même principe que l'Edge de WIFIHUB). |
| I-7 | « Pas de faux paiements » (§81), mais Mobile Money et paiement en ligne (§33) exigent des contrats avec des opérateurs. | Phase 10 : Mobile Money **déclaratif** (moyen + référence de transaction saisis par le caissier, rapprochement possible). C'est un vrai flux métier. Les intégrations API (Airtel Money, Moov, CinetPay…) arrivent quand un compte marchand existe, derrière `PaymentProvider`. |
| I-8 | « Pas de fausses données » (§81) contre « Restaurant de démo avec commandes et statistiques » (§71). | La démo est un **tenant marqué `is_demo`**, peuplé **par les vrais services** (vraies commandes, vrais paiements simulés comme espèces), jamais par des INSERT. Il est isolé comme n'importe quel client. |
| I-9 | **QR sans compte + commandes multi-clients** (§23, §43) : une photo du QR permet de commander depuis chez soi (canular, surcharge cuisine). | Par défaut, une commande QR arrive en `PENDING` et **doit être confirmée par le personnel**. Réglable par établissement. S'y ajoutent un code de session affiché sur la table pour rejoindre une table ouverte, et une limitation de débit. |
| I-10 | **Abonnements et fonctions payantes** (§66) contre **fonctionnement hors ligne** : un serveur local coupé ne peut pas vérifier l'abonnement. | Droits **signés** (Ed25519, `node:crypto`) mis en cache localement, avec un délai de grâce hors ligne (15 jours proposés). Même principe que la licence NoteXpress. |
| I-11 | **Horloges fausses** sur les PC de restaurant (pile BIOS, réglage manuel) : l'ordre des événements ne peut pas reposer sur `Date.now()`. | **HLC** (horloge logique hybride) sur toutes les données synchronisées. L'écart avec le Cloud est mesuré à chaque synchronisation et affiché s'il est anormal. |
| I-12 | **Manques métier** pour une caisse réelle : ouverture/fermeture de caisse (fond, écart, rapport Z), journée d'exploitation qui dépasse minuit, numérotation des commandes, avoirs/annulations, pourboires, exigences fiscales locales. | Ajoutés au plan : `business_day_cutoff_min` dès la phase 1 (05:00 par défaut), sessions de caisse et rapport Z en phase 6, numérotation par *autorité opérationnelle* (SYNC.md §5), annulation = nouvel événement (jamais un UPDATE destructif). |
| I-13 | `afrikaisse.local` (§52) : le mDNS n'est pas fiable sur Android, ni dans les navigateurs. | Méthode **fiable** : QR d'appairage affiché par le desktop (adresse IP + port + jeton), et réservation DHCP conseillée. mDNS en bonus. |
| I-14 | **PWA sur le LAN** : `http://192.168.x.x` n'est pas un contexte sécurisé, donc pas de service worker, de caméra, de notifications ni d'installation. | Postes du restaurant : `http://localhost` sur le PC (contexte sécurisé), **application native** (Capacitor) sur les tablettes et téléphones du personnel. Seul le menu client est une PWA, servie en HTTPS par le Cloud. |
| I-15 | Impression USB directe depuis un navigateur : impossible. | Agent d'impression local (Windows) et plugin Bluetooth ESC/POS dans l'application Android. |
| I-16 | Arabe demandé (§45). | RTL pris en compte dès la phase 1 : propriétés CSS logiques, `dir` piloté par la langue. |
| I-17 | Indisponibilité automatique (§37) : elle suppose un stock exact, rarement le cas au démarrage. | Option **par ingrédient** (« critique »), désactivée par défaut. |
| I-18 | **Pas de compilateur sur o2switch** (FAQ officielle), ni de toolset MSVC sur le poste de build (constaté pour PHARMINA). | **Aucun module natif** : `node:sqlite`, `scrypt` de `node:crypto`, `pg` en JavaScript pur. API livrée en **un seul fichier** esbuild. |

---

## 3. Contraintes réelles d'o2switch

### Vérifié

| Point | Source | Constat |
|---|---|---|
| Node.js | FAQ o2switch (mise à jour 04/06/2026) | Versions 6 à **24** via *Setup Node.js App*, exécutées par **Phusion Passenger**. `listen()` est intercepté, le port n'a pas d'importance. |
| Python | WIFIHUB en production | FastAPI via Passenger fonctionne (pont ASGI→WSGI). |
| PostgreSQL | WIFIHUB en production (`uapi PostgresqlFE`) | Disponible, bases illimitées ; aucune extension requise par WIFIHUB. |
| MySQL/MariaDB | Offre o2switch | Disponible. |
| Cron | Offre o2switch | Planification à la minute. |
| SSH | Offre o2switch | Disponible. Le terminal cPanel est bridé (processus, mémoire). |
| Compilateur | FAQ o2switch | **Bloqué par défaut** : pas de modules natifs npm. |
| WebSocket | WIFIHUB + FAQ o2switch | **Pas de WebSocket** derrière Passenger (constat WIFIHUB). o2switch dit en « limiter l'usage ». |
| Processus | WIFIHUB | Passenger **arrête l'application inactive** et la relance à la demande. Aucune tâche de fond permanente. |

### À mesurer sur le compte avant la phase 5 (commandes temps réel)

La **sonde** `infrastructure/o2switch/sonde` mesure en 3 minutes (voir DEPLOYMENT.md §1) :

- la version exacte de PostgreSQL, et le support de `GENERATED ALWAYS AS IDENTITY` et des extensions ;
- le handshake WebSocket (confirmer ou infirmer le constat ci-dessus) ;
- le **SSE** : les événements arrivent-ils à la seconde, ou bufferisés par LiteSpeed/Passenger ?
- la **durée maximale d'une requête** (25 s, 55 s, 95 s), qui borne le long-polling ;
- le nombre de processus Passenger simultanés, qui confirme qu'**aucun état ne doit vivre en mémoire**.

**Conséquence déjà appliquée** : aucun état en mémoire de processus. Le verrouillage de connexion
se lit dans `audit_logs`, le secret JWT et l'identité du nœud dans `node_state`.

---

## 4. Choix de la stack

### Comparaison

**Backend**

| Critère | Node.js + TypeScript | PHP 8 (Laravel/Symfony) |
|---|---|---|
| o2switch | Passenger, Node 24 | Natif |
| Même code sur le serveur local Windows | **Oui** (Node embarqué, comme Scolaar) | Il faudrait embarquer PHP + un serveur web |
| Partage des règles avec Web / mobile / desktop | **Oui** (TypeScript partout) | Non (double implémentation des prix, paniers, droits) |
| SQLite hors ligne sans module natif | **`node:sqlite` intégré** | PDO SQLite, OK |
| Expérience de l'équipe | PHARMINA, Scolaar (Node + TS) | — |

→ **Node.js 24 + TypeScript, Fastify 5.** Un monolithe modulaire (§80).

**Base de données**

| Critère | PostgreSQL | MySQL/MariaDB |
|---|---|---|
| `RETURNING`, DDL transactionnelle, index partiels | Oui | Partiel |
| Sémantique proche de SQLite (serveur local) | **Oui** | Moins |
| Éprouvé sur o2switch par l'équipe | **Oui (WIFIHUB)** | — |

→ **PostgreSQL dans le Cloud, SQLite sur le serveur local** (**ADR-001**). On garde deux moteurs parce
qu'un restaurant n'installe **aucun service de base de données**. SQLite = un fichier. Pas de port
à ouvrir (les ports réservés par Hyper-V ont bloqué PostgreSQL embarqué dans Scolaar), sauvegarde
par copie, WAL + `synchronous=FULL` résistant aux coupures de courant. Le coût est de maintenir deux
dialectes. Il est maîtrisé par **Kysely** (constructeur de requêtes typé, sans ORM) et par une
**suite de tests exécutée intégralement sur les deux moteurs**.

**Frontend** — React 19 + TypeScript + Vite. PWA pour le menu client uniquement (I-14).

**Mobile**

| Critère | Capacitor (React) | React Native | Flutter |
|---|---|---|---|
| Réutilise les écrans Web (serveur, manager) | **Oui** | Non | Non |
| Réutilise les règles TS (panier, prix, droits) | **Oui** | Oui | Non (Dart) |
| APK Android natif, plugins (Bluetooth, stockage sécurisé, push) | Oui | Oui | Oui |
| Vieilles WebView (Chrome 83 au Tchad) | Contraintes connues et résolues (WIFIHUB) | Sans objet | Sans objet |
| Build sur ce poste | **Éprouvé (WIFIHUB)** | Gradle, OK | Build Windows bloqué (School ID) |

→ **Capacitor** (**ADR-006**), décision confirmée en phase 15. L'API est la frontière, donc passer à
React Native ensuite ne toucherait ni le serveur ni les règles.

**Desktop**

| Critère | Electron | Tauri |
|---|---|---|
| Node inclus (serveur local, SQLite, impression) | **Oui** | Non (sidecar Node à part) |
| Chaîne de build sur ce poste | **Éprouvée (PHARMINA)** | Rust + MSVC absents |
| Poids | ~100 Mo | ~10 Mo |

→ **Serveur local = service Windows (Node 24 embarqué)** qui démarre sans session ouverte et survit
à un plantage de l'interface. **Console desktop = Electron** : POS, état du système, appairage,
impression. **Installateur Inno Setup** (éprouvé sur Scolaar) (**ADR-007**).

### Stack retenue

| Couche | Choix |
|---|---|
| Langage | TypeScript 5.9, Node.js 24 |
| API | Fastify 5, Zod 4, OpenAPI généré (`fastify-type-provider-zod`) |
| Accès aux données | Kysely 0.28 ; `pg` (Cloud), `node:sqlite` (local), PGlite (tests) |
| Authentification | JWT HS256 (`jose`), jetons de renouvellement opaques en rotation, `scrypt` |
| Web | React 19, Vite 7 |
| Mobile | Capacitor (phase 15) |
| Desktop | Service Windows + Electron + Inno Setup (phases 11, 16) |
| Tests | Vitest ; SQLite en mémoire + PostgreSQL WASM (PGlite) |
| Livraison Cloud | Bundle esbuild CommonJS unique → *Setup Node.js App* o2switch |

---

## 5. Architecture

```text
                              INTERNET
                                 │
             ┌───────────────────┴───────────────────┐
             │           AFRIKAISSE CLOUD             │  o2switch
             │  Passenger ─► server.cjs (profil cloud)│
             │    API REST · OpenAPI · SSE/polling    │
             │    PostgreSQL (multi-tenant)           │
             │    cron : purge, sauvegardes           │
             └───────▲──────────────────▲────────────┘
     HTTPS (client)  │                  │  HTTPS sortant (le local appelle, jamais l'inverse)
   Menu QR (PWA) ────┘                  │  push outbox · pull changements · travaux d'impression
   Back-office Web                      │
                                 ┌──────┴──────────────────────────────┐
                                 │  PC WINDOWS DU RESTAURANT            │
                                 │  Service « AfriKaisse Local »        │
                                 │   server.cjs (profil local)          │
                                 │   SQLite (WAL, FULL) · sync · impr.  │
                                 │  Console Electron (POS, état, QR)    │
                                 └──────┬───────────────────────────────┘
                                        │ LAN / Wi-Fi (HTTP + SSE)
                ┌──────────────┬────────┴─────┬───────────────┐
             Tablette KDS   App serveur     Imprimantes      POS additionnel
             (navigateur)   (Capacitor)     (ESC/POS TCP/USB)
```

**Principe central (ADR-002)** : *un seul programme, deux profils.* `services/api` démarre en
`AFK_PROFILE=cloud` (PostgreSQL, multi-tenant, back-office) ou en `AFK_PROFILE=local` (SQLite, un
seul tenant, écoute sur le LAN). Les règles métier, la validation, les droits et le journal de
synchronisation sont **le même code**.

**Modes d'exploitation d'un établissement** (ADR-004) :

| Mode | Pour qui | Autorité opérationnelle |
|---|---|---|
| `CLOUD` | Petit établissement sans PC, connexion correcte | Le Cloud |
| `HYBRID` | Établissement équipé d'un serveur local | **Le serveur local** |

L'autorité opérationnelle numérote les commandes, route les tickets et encaisse. Il n'y en a qu'une
par établissement, ce qui supprime la plupart des conflits de synchronisation (SYNC.md).

---

## 6. Schéma de données

Voir **DATABASE.md** : conventions, schéma cible complet par domaine et par phase, tables livrées
en phase 1, classification synchronisée / propre au nœud.

## 7. Flux Local ↔ Cloud

Voir **SYNC.md** (outbox, push, pull, idempotence, conflits, commandes QR en mode hybride, reprise
après crash) et **LOCAL.md** (serveur local, découverte, sécurité LAN, sauvegardes).

---

## 8. Organisation du dépôt

```text
AFRIKAISSE/
├── packages/
│   ├── core/          règles et contrats partagés (navigateur + Node) : rôles, permissions,
│   │                  UUID v7, HLC, devises, schémas Zod des entrées et des réponses
│   └── database/      types Kysely, dialectes (PostgreSQL, node:sqlite, PGlite), migrations
├── services/
│   └── api/           LE serveur : profils cloud et local ; routes → services → base
│       ├── src/lib/       accès (session, portée tenant), jetons, mots de passe, audit, outbox
│       ├── src/services/  logique métier (auth, équipe, organisation, back-office)
│       ├── src/routes/    HTTP + OpenAPI
│       └── test/          scénarios exécutés sur SQLite ET PostgreSQL
├── apps/
│   ├── web/           back-office et écrans du personnel (React)
│   ├── mobile/        (phase 15) Capacitor
│   └── desktop/       (phase 16) console Electron
├── infrastructure/
│   └── o2switch/      sonde d'environnement ; scripts de dépôt (à venir)
└── docs/
```

Écart assumé avec l'exemple du §78 : pas de `services/local-server` ni de `services/sync`
séparés. Le serveur local **est** `services/api` en profil local, et la synchronisation y sera un
module (`src/sync/`). Des paquets distincts dupliqueraient le démarrage, la configuration et les
tests pour rien (§80).

---

## Plan de phases (ajusté)

L'ordre du §83 est conservé. Les ajustements :

| Phase | Ajout ou précision |
|---|---|
| 1 | ✅ Livrée : architecture, auth, multi-tenant, RBAC, audit, **invariants hors ligne** (I-2) |
| 2 | ✅ Livrée : établissements (mode CLOUD/HYBRID, début de journée, archivage protégé), zones, tables, plan de salle en grille de cases, édition au doigt, disposition tout-ou-rien |
| **2 bis** | ✅ Livrée et vérifiée sur WebView Chrome 83 — **Application tablette Android** (ADR-011) : coque Capacitor, APK, connexion au Cloud ou au serveur local, écrans existants au doigt, test sur tablette réelle et sur émulateur à WebView ancienne (Chrome 83) |
| 5 | Journée d'exploitation, numérotation par autorité opérationnelle, historique de statut |
| 6 | **Sessions de caisse** (fond, écart, rapport X/Z), annulations comme événements |
| 11 | Service Windows, appairage par QR, choix de port dynamique (déjà amorcé) |
| 12 | Transport de synchronisation (le journal existe depuis la phase 1) |
| 17 | Droits signés hors ligne (I-10) |

## Registre des décisions

| ADR | Décision |
|---|---|
| 001 | PostgreSQL (Cloud) + SQLite (local), un seul code via Kysely, tests sur les deux |
| 002 | Un seul serveur, deux profils (`cloud` / `local`) |
| 003 | `tenant` = organisation cliente, `location` = établissement ; pas de table `restaurants` |
| 004 | Une seule autorité opérationnelle par établissement (Cloud ou serveur local) |
| 005 | Aucun module natif ; API livrée en un fichier |
| 006 | Mobile en Capacitor, confirmé en phase 15 |
| 007 | Local = service Windows + console Electron + Inno Setup |
| 008 | Rôles fixes, matrice de permissions dans le code (versionnée, testée, identique hors ligne) |
| 009 | Le Cloud n'appelle jamais le réseau du restaurant |
| 010 | Temps réel sans WebSocket : SSE / polling ; temps réel critique sur le LAN |
| 011 | **Tablette d'abord** (demande GLOBALTECH, 13/09/2026). L'appareil de référence de toutes les interfaces du personnel est la **tablette Android 10"**, au doigt, en paysage (1280×800) **et** en portrait (800×1280). Cibles tactiles ≥ 44 px, champs ≥ 16 px (pas de zoom au clavier), aucune action accessible seulement par survol, clic droit ou double-clic, vérification aux deux orientations à chaque phase. L'**application tablette** (Capacitor + appairage au serveur local) est avancée en **phase 2 bis**, avant le POS. POS, écran serveur et KDS sont conçus pour la tablette d'abord, le PC ensuite. |
