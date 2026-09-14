# AfriKaisse

**La caisse intelligente de la restauration africaine.**
Restaurant Operating System développé par **GLOBALTECH BUSINESS TD**.

Un seul écosystème pour les restaurants, cafés, hôtels, lounges, bars et fast-foods : site public,
SaaS Web, application mobile, logiciel desktop et serveur local. Menu QR, POS, tables, KDS, bar,
stock, paiements, statistiques. Il continue de fonctionner **quand Internet tombe**.

## État

| Phase | Contenu | État |
|---|---|---|
| Architecture | Analyse, incohérences, contraintes o2switch, stack, schéma, flux, dépôt | ✅ `docs/` |
| 1 | Authentification, multi-tenant, RBAC, audit, back-office, invariants hors ligne | ✅ |
| 2 | Établissements (mode Cloud / serveur local), zones, tables, plan de salle au doigt | ✅ |
| 2 bis | Application tablette Android : Cloud ou serveur local, session dans le Keystore, mode tactile imposé | ✅ vérifiée sur WebView Chrome 83 ; 59 tests sur SQLite **et** PostgreSQL |
| 3 | Menu (catégories, produits, versions, options, allergènes, photos compressées sur l'appareil), épuisé en un toucher, QR par table et planche A4, menu client par QR | ✅ 83 tests sur SQLite **et** PostgreSQL |
| 4-5 | Commande client par QR (panier, options, suivi, appel serveur/addition), écran Commandes du personnel en temps réel (confirmation, avancement, annulation motivée, tables à libérer), numéros par journée d'exploitation | ✅ 104 tests ; essai croisé téléphone ↔ tablette |
| 6 | Caisse tablette : vente au doigt, sur place/à emporter, remises motivées, encaissement espèces/mobile money/carte, addition partagée, reçu 80 mm, transfert et regroupement de tables, sessions de caisse (fond, entrées/sorties, rapport X, clôture Z avec écart) | ✅ 128 tests ; essai complet dans le navigateur |
| 7 | Postes de préparation (Cuisine, Bar, Grill…), écran cuisine sombre à trois colonnes avec minuteurs et signal, avancement par poste, commande prête quand tous les postes ont fini | ✅ 138 tests ; essai cuisine ↔ bar dans le navigateur |
| 8 | Plan de salle vivant pour les serveurs (libre, occupée, prête, appel/addition/QR, réglée), fiche de service, commande à table en plein écran ; scénario complet du cahier des charges (QR → cuisine → service → paiement → table libérée → Z) | ✅ 140 tests |
| 11 | **Serveur du restaurant installable** : `AfriKaisse-Setup.exe` (Node embarqué, application servie par le serveur, lanceur sans fenêtre, écran de démarrage, port résistant et vérifié, pare-feu limité au réseau local, démarrage avec Windows, données conservées) | ✅ paquet essayé sur le poste ; installateur compilé |
| 14 | Tableau de bord : chiffre d'affaires, encaissé, ticket moyen, jours, heures de pointe, modes de paiement, produits, export CSV | ✅ 148 tests |
| §70-71 | « Bien démarrer » (étapes de mise en route) et restaurant de démonstration en un geste (10 tables, 19 plats africains à options, postes cuisine/grill/bar) | ✅ 152 tests |
| 13 | Stock : articles, réceptions, pertes, inventaires, recettes par version, déduction à la confirmation et restitution à l'annulation, épuisé automatique et retour au réapprovisionnement, coût matière | ✅ 158 tests |
| §69 | Sauvegardes du serveur local : au démarrage avant migration et toutes les heures, copies vérifiées, rotation 24 h / 30 jours, sauvegarde à la demande | ✅ 160 tests ; essayé sur le paquet Windows |
| 9 | Impression réseau ESC/POS : tickets de préparation par poste à la confirmation, reçus, test, file avec relance, accents français ; tickets 80 mm par le navigateur sans serveur local | ✅ 163 tests (fausse imprimante TCP) |
| 12 | Synchronisation serveur local ↔ Cloud | À venir |

## Démarrer

Prérequis : Node.js ≥ 24.

```bash
npm install
npm run verify      # types + tests + bundle API + build web
npm run dev:api     # API http://127.0.0.1:4300
npm run dev:web     # Web http://localhost:5173
```

OpenAPI : `GET /api/openapi.json`.

## Principe

Un **seul serveur** (`services/api`), deux profils :

- `AFK_PROFILE=cloud` : PostgreSQL, multi-tenant, hébergé sur o2switch ;
- `AFK_PROFILE=local` : SQLite, sur le PC Windows du restaurant, joignable par le LAN, autonome
  hors ligne.

Les mêmes règles métier s'exécutent aux deux endroits. Toute modification écrit son événement de
synchronisation dans la même transaction.

## Dépôt

```text
packages/core       règles et contrats partagés (rôles, permissions, UUID v7, HLC, schémas)
packages/database   Kysely, dialectes PostgreSQL / SQLite / PGlite, migrations
services/api        serveur Fastify (cloud + local), tests
apps/web            back-office et écrans du personnel (React)
infrastructure/     sonde o2switch
docs/               architecture et guides
```

## Documentation

[ARCHITECTURE](docs/ARCHITECTURE.md) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md) ·
[SYNC](docs/SYNC.md) · [LOCAL](docs/LOCAL.md) · [SECURITY](docs/SECURITY.md) ·
[DEPLOYMENT](docs/DEPLOYMENT.md) · [TESTING](docs/TESTING.md) · [WEB](docs/WEB.md) ·
[MOBILE](docs/MOBILE.md) · [DESKTOP](docs/DESKTOP.md) · [USER_GUIDE](docs/USER_GUIDE.md)
