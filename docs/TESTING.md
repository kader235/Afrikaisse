# AfriKaisse — Tests

```bash
npm test              # tous les tests
npm run typecheck     # TypeScript strict sur tout le dépôt
npm run verify        # types + tests + bundle API + build web
```

## Stratégie

1. **Deux moteurs, un seul scénario.** Chaque test d'API tourne sur **SQLite** (serveur local) **et**
   **PostgreSQL** (PGlite, vrai PostgreSQL 17 compilé en WASM, sans service à installer). Une requête
   qui marche sur un moteur et pas sur l'autre casse la suite.
2. **Par HTTP.** Les tests passent par `app.inject` : routage, validation, sérialisation des réponses,
   droits et base. Rien n'est simulé.
3. **Temps contrôlable.** `startApp` injecte une horloge décalable (`clock.offsetMs`) pour les
   expirations et les délais de grâce, sans attendre.
4. **Le bundle livré est exécuté** : le script de vérification démarre `dist/server.cjs` sur un vrai
   fichier SQLite et un vrai port, puis le pilote en HTTP (inscription, `me`, refus de la seconde
   inscription locale, OpenAPI).

## Couverture de la phase 1 (37 tests)

| Domaine | Vérifié |
|---|---|
| Cœur | UUID v7 valide et trié ; HLC croissante quand l'horloge du PC recule, et qui dépasse un nœud en avance ; matrice des rôles ; hiérarchie ; normalisation des entrées |
| Inscription | Organisation + établissement + propriétaire en une transaction ; 4 événements de synchronisation ; audit ; doublon d'adresse (casse ignorée) ; mot de passe faible |
| Connexion | Message identique pour une adresse inconnue et un mauvais mot de passe ; échec tracé ; verrouillage après 5 échecs |
| Session | Rotation du jeton ; réutilisation simultanée tolérée ; réutilisation tardive = révocation ; cookie httpOnly en mode navigateur ; déconnexion immédiate ; changement de mot de passe qui déconnecte les autres appareils |
| Multi-tenant | Liste, modification, mot de passe, audit et établissement d'une autre organisation : invisibles (404) |
| RBAC | Serveur sans accès à l'équipe ; gérant qui ne peut ni créer un admin, ni toucher au propriétaire, ni modifier son propre rôle ; désactivation effective immédiatement |
| Comptes partagés | Rattachement autorisé ; mot de passe et nom protégés ; choix d'organisation à la connexion |
| Back-office | Invisible (404) pour un restaurant ; suspension et réactivation effectives immédiatement |
| Profil local | Configuration unique, pas de back-office, événements en attente d'envoi |
| OpenAPI | Routes publiées |

## Couverture de la phase 2 (20 tests de plus, 57 au total)

| Domaine | Vérifié |
|---|---|
| Géométrie (cœur) | Chevauchement et sortie de plan (deux tables qui se touchent ne se chevauchent pas) ; place libre avec allée puis sans allée ; plan plein ; fuseau horaire inconnu |
| Établissements | Premier établissement en mode Cloud ; création avec adresse vide → null ; fuseau invalide refusé ; PATCH sans écraser les champs absents ; audit |
| Archivage | Dernier établissement protégé ; établissement avec des membres qui n'ont que lui protégé ; liste avec et sans archivés ; réactivation |
| Portée | Un administrateur rattaché à un établissement ne voit et ne modifie que le sien (404 ailleurs, 403 à la création) |
| Tables | Placement automatique de 7 tables sans chevauchement ; table rectangulaire 4 × 2 ; libellé unique sans tenir compte de la casse ni des espaces ; emplacement occupé ou hors plan refusé ; 7 événements de synchronisation |
| Disposition | Plan invalide refusé en bloc (rien ne bouge) avec les libellés en conflit ; plan valide enregistré, pivot compris ; audit |
| Zones | Réduction refusée si une table sortirait (libellés renvoyés) ; archivage d'une zone non vide refusé ; libellé d'une table archivée réutilisable ; déplacement vers une autre zone avec une place trouvée |
| Droits | Serveur : lecture seule ; cuisine : pas d'accès au plan ; autre organisation : 404 partout |
| Profil local | Établissement en mode serveur local, impossible de le repasser en Cloud |
| Migration | `0002_floor` appliquée sur une base de la phase 1 déjà remplie (base de démonstration de l'interface) |

## Scénario du §76 — plan

| Étape | Phase qui la rend testable |
|---|---|
| Table 12 → QR → menu | 3-4 |
| Burger + supplément → panier → commander | 4-5 |
| POS → KDS → cuisine → READY | 6-7 |
| Serveur → addition → paiement → reçu → table libérée | 8-10 |
| Internet coupé → commande → cuisine → cash → Internet rétabli → sync → Cloud | 11-12 |

Chaque phase ajoute sa portion du scénario à `services/api/test/`, sur les deux moteurs. Le
scénario hors ligne complet sera un test de bout en bout qui lance **deux** processus (un Cloud
PostgreSQL, un local SQLite) et coupe réellement le lien entre eux.
