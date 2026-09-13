# AfriKaisse — Sécurité

## En place (phase 1, testé)

### Authentification
- Mots de passe : **scrypt** (N=16384, r=8, p=1, sel 16 octets), paramètres stockés avec le hash pour
  pouvoir durcir plus tard. Comparaison à temps constant. Une adresse inconnue coûte le même calcul
  qu'un vrai compte : on ne peut pas deviner quelles adresses existent au temps de réponse.
- Minimum 10 caractères.
- **Verrouillage** : 5 échecs **consécutifs** en 15 min → 429, même avec le bon mot de passe. L'état
  est lu dans `audit_logs`, pas en mémoire, donc valable avec plusieurs processus Passenger.
- Même message pour « adresse inconnue » et « mauvais mot de passe ».

### Jetons
- Accès : JWT HS256, **15 min**. Il ne contient que l'utilisateur et la session. Rôle, organisation
  et statuts sont **relus en base à chaque requête**, donc une désactivation, une suspension ou un
  changement de rôle s'appliquent **immédiatement**.
- Émetteur lié au nœud (`afrikaisse:<nodeId>`) : un jeton du Cloud n'est pas accepté par un serveur
  local, et inversement.
- Renouvellement : jeton opaque de 256 bits, **seule son empreinte SHA-256 est stockée**, rotation à
  chaque usage. Une réutilisation au-delà de 10 s révoque toute la session.
- Navigateur : cookie `httpOnly`, `SameSite=Strict`, `Path=/api/auth`, `Secure` dans le Cloud. Le
  jeton d'accès vit **en mémoire** (jamais dans `localStorage`).
- Secret JWT : variable `AFK_JWT_SECRET` ; à défaut, secret aléatoire de 384 bits généré une fois et
  conservé dans `node_state`.

### Isolation multi-tenant
- Toute requête métier passe par `requireTenant()` qui produit une `TenantScope`. Les services ne
  lisent le tenant **que** depuis cette portée, jamais depuis le corps de la requête.
- Un identifiant d'une autre organisation répond **404**, ce qui ne révèle pas son existence.
  Testé : lecture, modification, mot de passe, audit, attribution d'un établissement étranger.
- **Comptes partagés** : une personne peut appartenir à deux organisations. Une organisation ne peut
  **ni changer le mot de passe ni renommer** un compte rattaché ailleurs. Sinon, il suffirait d'ajouter
  l'adresse d'un employé d'un concurrent puis de réinitialiser son mot de passe pour prendre son
  compte. Testé.

### Autorisations
- Matrice rôle → permissions dans `packages/core/src/roles.ts`, identique en ligne et hors ligne.
- Hiérarchie : on n'attribue, ne modifie et ne désactive qu'un rôle **strictement inférieur** au sien
  (le propriétaire peut tout).
- Interdit de modifier son propre accès (rôle, statut, établissement), et d'enlever le dernier
  propriétaire actif.
- Back-office AfriKaisse : drapeau `is_platform_admin`, donné **uniquement en ligne de commande**
  (`cli grant-platform-admin`). Les routes répondent 404 aux autres et n'existent pas en profil local.

### Audit
Tracés : inscription, connexion et échec, réutilisation de jeton, changement d'organisation,
changement et échec de changement de mot de passe, ajout et modification de membre (avant/après),
réinitialisation de mot de passe, renommage d'organisation, suspension et réactivation. Les
échecs sont écrits **hors** de la transaction de la requête, sinon son annulation les effacerait.

### En-têtes et entrées
- `@fastify/helmet`, CORS fermé par défaut (liste blanche `AFK_CORS_ORIGINS`), corps limité à 1 Mo.
- Toutes les entrées et **toutes les réponses** validées par Zod (une réponse qui fuirait un champ
  non déclaré, comme `password_hash`, est rejetée par le sérialiseur).

## Points connus, à traiter

| Point | Phase |
|---|---|
| Limitation de débit par IP (inscription, connexion, routes publiques QR) | 4 (avant ouverture publique) |
| Traduction des messages d'erreur côté client à partir des codes | 4 |
| Vérification de l'adresse e-mail et récupération de mot de passe | 4 |
| Connexion par code PIN sur appareil appairé | 6 |
| Jetons d'appareil pour la synchronisation, révocables | 11-12 |
| Le flux de synchronisation transporte `password_hash` et `pin_hash` (nécessaires à la connexion hors ligne) : il faut TLS et l'authentification de l'appareil | 12 |
| Row Level Security PostgreSQL en filet de sécurité | 18 |
| Double authentification pour propriétaires et back-office | 18 |
| Signature des mises à jour et des droits d'abonnement (Ed25519) | 16-17 |
| Sauvegardes chiffrées hors du poste | 11 |

## Signaler une faille

GLOBALTECH BUSINESS TD — ne jamais publier le détail avant correction.
