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

## Couverture de la phase 3 (83 tests au total)

| Domaine | Vérifié |
|---|---|
| Argent (cœur) | FCFA sans décimales, euro à deux ; lecture « 5 500 », « 12,50 € » ; refus d'une précision impossible |
| Prix d'une ligne (cœur) | Version + options × quantité ; prix promo ; refus : version manquante ou inconnue, groupe obligatoire oublié, maximum dépassé, option épuisée, d'un autre produit ou choisie deux fois, quantité 0, produit épuisé |
| Jetons de QR | 200 jetons tous différents, 22 caractères base64url |
| Photos | Lecture des en-têtes PNG, JPEG, WebP ; faux fichier refusé ; type annoncé différent du contenu refusé ; 850 Ko refusés ; service avec cache immuable, ETag/304, en-tête cross-origin ; photo d'une autre organisation inutilisable |
| Catégories | Ordre (liste incomplète refusée), masquage, archivage refusé tant qu'un produit y reste |
| Produits | Versions et groupes remplacés proprement (id conservé, variante étrangère refusée), allergènes dédoublonnés, prix promo ≥ prix refusé, audit « prix modifié », événements de synchronisation dont la suppression d'un lien |
| Options | Min > max et max > nombre d'options refusés ; archivage refusé tant qu'un produit l'utilise (noms renvoyés) |
| Disponibilité | La cuisine marque un produit et une option épuisés mais ne change pas un prix ; le serveur ne peut pas |
| QR et menu public | Un QR par table, adresse publique configurée ; menu sans session : catégorie masquée et produit archivé absents, épuisé signalé ; régénération (ancien jeton → 404) ; table archivée → 404 ; organisation suspendue → 404 ; jeton malformé → 400 |
| Isolation | Menu, produit, catégorie, groupe, disponibilité, QR d'une autre organisation : 404 |

## Vérification de l'application tablette (phase 2 bis)

Banc : APK de débogage sur l'AVD `WifiHub_83` (**Android 11, WebView Chrome 83.0.4103.106**, le cas
des tablettes jamais mises à jour), affichage forcé en tablette paysage (`wm size 1280x800`,
`wm density 160`), API de démonstration sur le poste joint par `http://10.0.2.2:3000`.
Gestes par **vrais touchers** (`adb shell input tap/text`), lectures par le protocole de débogage de
la WebView.

| Vérifié | Résultat |
|---|---|
| Démarrage sur WebView 83 | Écrans affichés, pas de page blanche ; mode natif détecté |
| Connexion au serveur local | Test `/api/health` par HTTP natif, choix enregistré, écran de connexion avec « Serveur : 10.0.2.2:3000 » |
| HTTP vers Internet | `http://example.com` refusé avant tout appel (HTTPS exigé hors réseau local) |
| Cloud injoignable | Message clair après le délai, choix précédent inchangé |
| Connexion et plan de salle | Compte de démonstration connecté, plan avec ses 5 tables |
| Session | Conservée après arrêt complet de l'application (jeton relu dans le Keystore) |
| Tactile | **Défaut trouvé et corrigé** : la WebView 83 ne déclarait pas `pointer: coarse`, les commandes restaient à 30 px. Mode tactile imposé dans l'application : boutons 44 px, onglets 52 px, onglets de zone 48 px, tables 78 px, sans débordement |
| Barres système | Bande sous la barre d'état et barres au bleu AfriKaisse (plus de bande blanche) |

Règle de pilotage à retenir : le clavier virtuel remonte les fenêtres. Fermer le clavier et relire les
positions avant chaque toucher, sinon le geste tombe sur une touche du clavier.

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
