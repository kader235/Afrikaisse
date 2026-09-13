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

## Temps réel (phases 5-8)

- **Serveur local** : `GET /api/stream` en **SSE** (KDS, serveurs, POS), avec reprise par
  `Last-Event-ID`. Repli sur polling `?since=` si le flux se coupe.
- **Cloud** : SSE si la sonde o2switch confirme qu'il n'est pas bufferisé, sinon polling adaptatif
  (2 s quand une commande est en cours, 15 s au repos). Pas de WebSocket (ADR-010).

## Groupes de routes à venir

`/api/locations` · `/api/zones` · `/api/tables` · `/api/menu` · `/api/categories` · `/api/products` ·
`/api/modifiers` · `/api/qr/{token}` (public) · `/api/orders` · `/api/kitchen` · `/api/stations` ·
`/api/payments` · `/api/cash-sessions` · `/api/inventory` · `/api/reports` · `/api/sync` ·
`/api/devices` · `/api/stream`.
