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

## Couverture des phases 4-5 (104 tests au total)

| Domaine | Vérifié |
|---|---|
| Cycle de vie (cœur) | Transitions dans l'ordre du service, jamais de retour arrière, états finaux |
| Journée d'exploitation (cœur) | Service de nuit compté la veille ; fuseau de l'établissement (N'Djamena ≠ Dakar au même instant) |
| Commande QR | Prix recalculés (un prix envoyé par le client est ignoré), version et options copiées, en attente, numéros 1-2-3, **même session pour deux clients de la même table**, session différente pour une autre table, historique « Client (QR) », 3 événements `ORDER_PLACED` |
| Paniers invalides | Version manquante, groupe obligatoire oublié, article épuisé, article d'un autre restaurant, panier vide, QR inconnu |
| Numéros | Retour à 1 à la journée suivante |
| Personnel | Cuisine ne confirme pas ; serveur confirme ; confirmation répétée sans effet ; cuisine passe en préparation ; retour arrière refusé ; annulation refusée au serveur, exigeant un motif du responsable ; historique complet ; audit ; suivi client mis à jour ; un autre téléphone ne voit rien |
| Flux d'activité | Liste complète puis vide, puis uniquement la nouvelle commande et le nouvel appel, curseur croissant |
| Appels | Pas de doublon, traité par le personnel (nom enregistré), nouvel appel possible ensuite |
| Tables | Libération refusée avec une commande en cours, acceptée une fois terminée ; commande suivante dans une nouvelle session |
| Anti-abus | 6ᵉ commande en une minute refusée (429) ; établissement en mode serveur local sans serveur joignable → 503 |
| Isolation | Liste, flux et statut des commandes d'une autre organisation : 404 |

**Essai croisé dans le navigateur** (téléphone 375 px + tablette 1280 × 800, API de démonstration) :
- composition d'un burger avec « Ajouter » grisé tant que la cuisson manque, puis prix exact ;
- panier à 10 000 FCFA et commande envoyée ;
- sur la tablette, commande apparue seule en moins de 3 s avec la pastille, détail exact, puis confirmation ;
- appel « serveur » reçu sur la tablette puis traité.

## Couverture de la phase 6 (128 tests au total)

| Domaine | Vérifié |
|---|---|
| Calculs (cœur) | Remise en pourcentage arrondie et plafonnée ; état de paiement ; parts égales qui conservent le total ; répartition la plus ancienne d'abord ; coupures proposées en espèces ; motif de remise et somme remise exigés |
| Prise de commande | Confirmée d'emblée par le personnel, en salle et à emporter ; origine POS / serveur ; cuisine refusée ; catégorie masquée vendable en caisse mais pas par QR ; cuisson oubliée refusée ; table d'une autre organisation : 404 |
| Caisse | Encaissement refusé caisse fermée ; serveur ne peut pas ouvrir ; une seule caisse ouverte |
| Comptoir | Espèces : 10 000 remis pour 8 500, 1 500 rendus ; reçus n°1 puis n°2 ; payée puis servie = terminée ; montant supérieur au reste refusé ; somme remise insuffisante refusée ; événements `PAYMENT_RECORDED` |
| Addition partagée | Commande QR + commande caisse sur T1 ; « Terminer » refusé sans paiement ; mobile money 4 750 réparti 3 000 + 1 750 ; espèces pour le reste ; toutes terminées ; **table libérée seule** ; résumé par mode |
| Remise | Caissier refusé ; motif exigé ; 120 % refusé ; 10 % puis offert puis retirée ; 3 entrées au journal ; refusée après un paiement |
| Annulation de paiement | Caissier refusé ; motif exigé ; note rouverte ; deuxième annulation sans effet ; commande payée non annulable ; totaux des annulés |
| Clôture Z | Entrée/sortie, sortie trop grande refusée ; espèces attendues 15 000 ; comptées 14 800 → écart −200 ; double clôture, mouvement, paiement et annulation refusés ensuite ; historique ; nouvelle ouverture possible |
| Tables | Transfert vers une table libre ; regroupement sur une table occupée (une seule note) ; table archivée refusée ; audit |
| Isolation | Notes, caisse, paiement, reçu, annulation, remise, transfert, session d'une autre organisation : 404 |

**Essai dans le navigateur** (tablette 1280 × 800, base de démonstration) :
- ouverture avec 20 000 de fond ;
- burger à options (Ajouter grisé tant que la cuisson manque) et 2 eaux à emporter pour « Moussa » ;
- « Envoyer et encaisser », 10 000 remis, rendu 3 100, reçu n°1 ;
- note T1 : remise 10 % (10 000 → 9 000) ;
- ½ en Airtel Money (réf. AM-778812), reste 4 500 en espèces, note « Réglée » ;
- sortie de 1 000 : espèces attendues 30 400 ;
- clôture Z.

## Couverture de la phase 7 (138 tests au total)

| Domaine | Vérifié |
|---|---|
| Postes | Cuisine et Bar créés à l'inscription (événements de synchronisation compris) ; nombre de produits par poste ; serveur refusé ; cuisine peut lire ; renommage ; archivage refusé avec produits puis accepté ; affectation à un poste archivé (409) ou d'un autre restaurant (404) |
| Routage | Brochettes → Grill, bissap → Bar, riz sans poste → Cuisine ; articles « à préparer » |
| Écran cuisine | Serveur refusé ; commencer au grill → commande en préparation ; prêt au grill sans rendre la commande prête ; cuisinier refusé sur le bar, et sur « tous les postes » qui inclut le bar ; barman prêt ; rappel ; dernier poste prêt → commande prête, historique complet ; rappel refusé ensuite ; autre organisation 404 |
| Tout prêt d'un coup | L'étape « en préparation » reste dans l'historique |
| QR | Commande en attente refusée en cuisine ; « prête » depuis l'écran Commandes = tous les articles prêts ; flux d'activité avec les postes |

**Essai dans le navigateur** (tablette 1280 × 800) :
- boissons affectées au Bar, commande T2 (2 poulets yassa « Bien cuit » + 1 eau) ;
- poste Cuisine : seul le yassa, « Commencer » → colonne En préparation ;
- poste Bar : seule l'eau, « Prêt » → colonne Prêt, bouton « Rappeler » ;
- Cuisine « Prêt » → « Annoncée en salle », commande « Prête » (historique Confirmée → En préparation → Prête) ;
- minuteur rouge sur une commande de 48 min.

## Phase 8 et scénario du cahier des charges (140 tests au total)

La phase 8 est un écran : elle réutilise les routes des phases 4 à 7. Elle ajoute le **scénario §76**
(`services/api/test/scenario.test.ts`), joué de bout en bout avec les vrais rôles, sur les deux moteurs :

1. le client scanne le QR de la table 12, commande un burger + fromage et 2 jus (en attente, 7 500) ;
2. le serveur voit la note sur la table et confirme ;
3. la cuisine commence, le bar termine sa part, la cuisine termine → commande prête ;
4. le serveur sert ; le téléphone du client affiche « servie » ;
5. le client demande l'addition, le serveur ajoute un jus (même note), le bar le prépare, il est servi ;
6. le serveur ne peut pas encaisser (403) ; le caissier ouvre sa caisse, voit la note à 8 500 avec 2 commandes, encaisse 10 000 en espèces (rendu 1 500, reçu n°1) ;
7. les deux commandes sont terminées, **la table est libérée**, la demande d'addition est close, le client voit « terminée » ;
8. clôture Z : 13 500 attendus, 13 500 comptés, écart 0 ;
9. traçabilité : 2 `ORDER_PLACED`, 1 `PAYMENT_RECORDED`, journal (commande QR, ouverture et clôture de caisse).

**Essai du plan vivant dans le navigateur** (tablette 1280 × 800) :
- T1 réglée (pointillés), T2 « Prêt » (vert, badge), compteur « Occupées 2 » ;
- fiche de T2 : commande n°3 prête, addition 8 700 ;
- « Servie » → T2 repasse en occupée ;
- T3 libre → « Nouvelle commande » en plein écran « Table T3 », sans encaissement pour ce parcours → envoyée ; T3 devient occupée.

## Phases 11 et 14 (148 tests au total)

| Domaine | Vérifié |
|---|---|
| Application web servie par l'API | Page, script d'`assets/` (cache définitif), SVG, menu client `/m/<jeton>` ; écran rechargé → `index.html` ; fichier absent → 404 ; trois tentatives de sortie du dossier (`..%2f`, `%2e%2e`, octet nul) → 404 ; `/api/inconnue` reste une erreur JSON |
| Santé | Profil local : adresses du réseau ; Cloud : ni adresses ni pages |
| Rapport de ventes | Sur deux journées : comptoir en espèces, table avec remise de 10 % en mobile money, commande annulée, commande QR en attente, commande du lendemain par carte → chiffre d'affaires 12 800, 3 commandes, ticket moyen 4 266, encaissé 12 800, remises 200, 5 articles, 1 annulée à 1 000 ; détail par jour, mode, origine, service, produits ; journée seule |
| Droits et période | Début après fin, plus de 366 jours, date mal formée → 400 ; serveur et caissier → 403 ; gérant → rapport vide avec la journée ; autre organisation → 404 |

**Essai du paquet Windows**, sans rien installer : la charge est lancée par son lanceur, avec un
dossier de données d'essai, sur le poste de développement.

Sur ce poste, 7300, 8300, 9300 et 18300 refusent l'écoute IPv4, et 3000 est occupé par une autre API. L'essai a fait apparaître deux défauts, corrigés :
1. Windows laissait le serveur écouter 0.0.0.0:3000 alors qu'un autre programme tenait 127.0.0.1:3000 : le lanceur parlait à l'autre programme. Désormais, un port qui répond déjà est sauté, et le lanceur exige le **profil local et l'identifiant du nœud** écrits dans `port.txt`.
2. Aucun candidat libre sur ce poste : dernier recours, un port attribué par Windows, **retenu** pour les démarrages suivants.

Résultat :
- port 40535 retenu ;
- santé « local » avec l'adresse 192.168.100.2:40535 ;
- application, écran `/caisse`, sonde `afk-ping.svg` et menu client servis ;
- inscription du restaurant ; seconde inscription refusée (« déjà configuré ») ;
- relance : « fonctionne déjà » ;
- arrêt : serveur injoignable ;
- redémarrage sur le même port.

Installateur `AfriKaisse-Setup-0.1.0.exe` compilé (Inno Setup 6). L'installation réelle
(administrateur, pare-feu) reste à faire par Kader sur un poste.

## Mise en route et démonstration, §70-71 (152 tests au total)

| Domaine | Vérifié |
|---|---|
| État de mise en route | Restaurant neuf : 0 table, 0 produit, 2 postes, 1 membre, pas prêt ; après démonstration : 2 zones, 10 tables, 5 catégories, 19 produits, 3 postes, prêt ; première commande comptée |
| Démonstration | Serveur refusé ; installée une fois (seconde fois 409) ; grillades au Grill, boissons au Bar ; 10 QR et menu client aux 5 catégories ; vente immédiate d'un burger double à options + 2 brochettes = 14 500 ; journal `demo.loaded` |
| Protection | Établissement avec un produit : refus « vide » ; autre organisation : 404 |

**Essai dans le navigateur** :
- création du restaurant « Maquis Démo Centre » ;
- ouverture directe sur « Bien démarrer » (0 étape sur 5, offre de démonstration) ;
- installation de la démonstration ;
- étapes « salle » et « carte » cochées ;
- plan de salle avec Salle et Terrasse ;
- menu aux 5 catégories.

## Phase 13 — stock (158 tests au total)

| Domaine | Vérifié |
|---|---|
| Articles et mouvements | Nouvel article vide « épuisé » ; réception de 10 à 1 500 → valeur 15 000 ; quantités décimales (5,5 kg ; 0,33 l) ; inventaire compté → écart −9 ; perte sans motif 400 ; sortie au-delà du stock 409 ; 4 décimales 400 |
| Recettes | Poulet + riz ; bissap par version (0,33 l / 1 l) ; version d'un autre produit 404 ; même article deux fois 400 ; article d'un autre restaurant 404 |
| Ventes | Commande caisse de 2 yassas, 1 bissap 1 l et du pain sans recette → poulet 8, riz 5,1, bissap 1 ; mouvement « vente » avec le n° de commande ; annulation → stock restauré ; commande QR en attente : rien ; confirmée (deux fois) : une seule déduction |
| Rupture | Dernier poulet vendu → yassa épuisé en caisse et sur le menu QR, nouvelle commande refusée ; réception → disponible ; épuisé à la main : le stock ne le remet pas en vente |
| Droits et isolation | Serveur refusé ; magasinier crée un article ; archivage refusé tant qu'une recette l'utilise ; autre organisation 404 |

## §69 — sauvegardes du serveur local (160 tests au total)

| Domaine | Vérifié |
|---|---|
| Rotation | 72 copies horaires et 40 journalières : les 24 plus récentes gardées ; au-delà, une par jour ; rien au-delà de 30 jours |
| Sauvegarde | Serveur local sur un vrai fichier SQLite : copie créée, relue (organisation présente), listée, tracée ; gérant refusé ; Cloud : désactivée (liste vide, 409) |

Essai sur le paquet Windows :
- au lancement, `afrikaisse-…-demarrage.sqlite` est créé **avant** la migration 0007 (504 Ko) ;
- « Sauvegarder maintenant » produit une copie de 553 Ko, après migration ;
- les deux copies sont listées par l'API.

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
