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
| 4 | Commande client depuis le QR (panier, envoi) | À venir |

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
