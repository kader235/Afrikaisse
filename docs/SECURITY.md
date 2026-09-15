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
- **Limites par adresse IP** (phase 18, `services/api/src/lib/rateLimit.ts`) : inscription 10 par heure,
  connexion 30 par 10 min, renouvellement de session 120 par 10 min, commandes et appels QR 30 par
  10 min **par table**, appairage 20 par 10 min ; au-delà, 429 avec `Retry-After`. Les lectures ne sont
  pas limitées : les téléphones d'un même Wi-Fi partagent une adresse publique et suivent leur
  commande en boucle. Compteurs en mémoire (un seul processus). S'ajoute au verrouillage par compte.
- **Politique de sécurité du contenu** sur les pages servies par le serveur local : scripts, styles,
  images et connexions du serveur lui-même uniquement, `frame-ancestors 'none'`. Dans le Cloud, Apache
  pose le même en-tête (DEPLOYMENT.md §6).
- **Serveurs locaux révocables** (phase 17) : `POST /api/devices/{id}/revoke` efface l'empreinte du
  secret ; le PC est refusé dès sa requête suivante.

### Back-office, supervision, journaux, mises à jour (§67-§74)
- **Back-office** (`/api/platform/*`, profil cloud seulement) : le contrôle `is_platform_admin` se fait
  dans `onRequest`, **avant** la validation des paramètres. Un client connecté reçoit 404 sur toutes
  les routes, même avec un identifiant mal formé ; un anonyme 401. Testé pour propriétaire et
  responsable, et sur le serveur local (routes absentes).
- **Suspension d'un compte** depuis le back-office : statut `DISABLED`, toutes les sessions révoquées,
  changement envoyé aux serveurs locaux de chaque organisation, audit dans chacune. Impossible sur son
  propre compte ou sur un autre compte back-office (retirer d'abord le droit en ligne de commande).
- **Journal d'erreurs** (`error_logs`) : seulement les 500 ; identifiant de requête (UUID, renvoyé
  au client dans `details.requestId`), méthode, **motif** de route, code, organisation. Ni corps, ni
  en-têtes, ni adresse IP ; e-mails, jetons et numéros effacés du message. 2 000 lignes et 30 jours au
  plus.
- **Supervision** : propriétaire, administrateur, responsable (`devices.manage`), bornée à
  l'établissement. Le signe de vie d'un écran cuisine demande `orders.read` ; un identifiant d'écran
  déjà pris par une autre organisation répond 404.
- **Journaux par catégorie** (§74) : `security` reçoit les verrouillages, identifiants refusés, jetons
  invalides, annonces de version à la signature invalide et suspensions de compte.
- **Mises à jour signées** (Ed25519, `node:crypto`) : la clé publique est embarquée à la construction ;
  la clé privée n'est lue que par la ligne de commande, jamais par le serveur web. Les octets signés
  sont une liste ordonnée et versionnée (canal, version, date, notes, lien, SHA-256) : changer un seul
  champ, dont le lien de téléchargement, invalide l'annonce. Lien `https://` obligatoire. Le serveur
  local n'installe jamais rien ; l'installateur copie la base avant de remplacer le programme.

## Points connus, à traiter

| Point | Phase |
|---|---|
| Traduction des messages d'erreur côté client à partir des codes | 4 |
| Vérification de l'adresse e-mail et récupération de mot de passe | 4 |
| Connexion par code PIN sur appareil appairé | 6 |
| Le flux de synchronisation transporte `password_hash` et `pin_hash` (nécessaires à la connexion hors ligne) : il faut TLS et l'authentification de l'appareil | 12 |
| Row Level Security PostgreSQL en filet de sécurité | après ouverture |
| Double authentification pour propriétaires et back-office | après ouverture |
| Signature de code de l'installateur Windows (SmartScreen) ; l'annonce de version est déjà signée (§73) | 16 |
| Révocation d'une clé de signature des versions compromise : aujourd'hui, nouvelle clé = nouvelle construction à installer à la main | après ouverture |
| Sauvegardes chiffrées hors du poste | 11 |

## Signaler une faille

GLOBALTECH BUSINESS TD — ne jamais publier le détail avant correction.
