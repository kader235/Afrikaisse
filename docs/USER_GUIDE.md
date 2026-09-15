# AfriKaisse — Guide utilisateur

> Ce guide suit les fonctions **réellement disponibles**. Il s'enrichit à chaque phase.

## Créer son restaurant

1. Ouvrir AfriKaisse, puis **Créer mon restaurant**.
2. Renseigner :
   - **Nom de l'organisation** : le nom du groupe, ou celui du restaurant s'il n'y en a qu'un.
   - **Premier établissement** et son **type** (restaurant, hôtel, café, bar, lounge, fast-food,
     boulangerie, pâtisserie, food court).
   - **Pays** : il préremplit le fuseau horaire et la devise (modifiable).
   - Votre nom, votre adresse e-mail et un mot de passe d'au moins 10 caractères.
3. Vous êtes connecté comme **Propriétaire**.

## Se repérer dans l'application

- **En haut** : le restaurant et l'établissement ouverts, les commandes **à traiter** (un clic ouvre
  Commandes), l'état de la liaison, et votre nom : il ouvre votre compte, le changement
  d'organisation, la langue, le thème **clair ou sombre** et **Se déconnecter**.
- **À gauche**, les rubriques regroupées par activité (seules celles de votre rôle s'affichent) :
  - **Tableau de bord** ;
  - **Vente** : Caisse, Commandes, Tables ;
  - **Restaurant** : Cuisine, Menu ;
  - **Gestion** : Stock, Établissements ;
  - **Administration** : Personnel, Paramètres (organisation, abonnement, synchronisation,
    sauvegardes), Journal, Supervision.
- Sur tablette, la colonne se resserre : l'icône au-dessus du nom de la rubrique.
- Sur téléphone, une barre en bas donne les écrans de votre métier et **Plus** ouvre toutes les
  rubriques :
  - Propriétaire et administrateur : Tableau de bord, Commandes, Caisse, Menu.
  - Gérant : Commandes, Caisse, Tables, Menu.
  - Caissier : Caisse, Commandes. Serveur : Tables, Commandes. Cuisine et bar : Cuisine.

## L'assistant de mise en route

Après la création du restaurant, l'**assistant de mise en route** s'ouvre tout seul (propriétaire et
administrateur). Il se rouvre à tout moment : **Administration → Paramètres → Assistant de mise en
route**.

- À gauche, les 12 étapes numérotées ; une étape faite est cochée en vert. Toucher une étape y va
  directement.
- En bas à droite : **Précédent**, **Suivant**, **Terminer**. **Suivant** enregistre l'étape ; sur une
  étape laissée vide, il la **passe** (« passée »). On la reprend plus tard.
- **Fermer** (en haut à droite) : rien n'est perdu. L'assistant reprend à la première étape ni faite
  ni passée.

| Étape | Ce qu'on y fait |
|---|---|
| 1. Restaurant | Nom et type de l'établissement |
| 2. Logo | **Choisir une image** (réduite sur l'appareil) ; **Retirer**. Le logo apparaît sur le reçu, les chevalets QR et le menu client |
| 3. Adresse | Adresse et téléphone (imprimés sur le reçu) |
| 4. Devise | Pays (préremplit devise et fuseau), devise, fuseau horaire |
| 5. Catégories | Saisie d'une catégorie, ajout en un toucher (Entrées, Plats, Grillades…), **Importer des plats** |
| 6. Produits | Nom, catégorie, prix, **Ajouter** ; ou **Importer des plats** |
| 7. Tables | Une ligne par zone : nom, nombre de tables, places. **Créer les tables** : « 10 tables en salle, 4 en terrasse » donne T1 à T10 et TE1 à TE4, rangées avec des allées, et l'aperçu du plan. Dans une zone qui existe déjà, les tables prennent les places libres et la numérotation continue |
| 8. QR | Les chevalets de chaque table : affichage en grand, impression, régénération |
| 9. Stations | Les postes de préparation (Cuisine, Bar, Grill…) |
| 10. Utilisateurs | Nom, e-mail, rôle, mot de passe proposé. Le mot de passe s'affiche **une seule fois** après l'ajout : notez-le |
| 11. Imprimantes | Ajouter une imprimante de tickets, ou **Suivant** pour passer |
| 12. Test | **Lancer le test** : une vraie commande part aux postes (et aux imprimantes s'il y en a). Le tableau montre le poste qui l'a reçue. **Annuler la commande de test** l'annule avec le motif « Commande de test de la mise en route », inscrit au journal |

Quand toutes les étapes sont faites ou passées : **Votre restaurant est prêt.** avec le bilan de ce qui
est configuré. **Terminer** ouvre le tableau de bord ; l'assistant ne s'ouvre plus tout seul.

La commande de test annulée compte dans les « annulées » du tableau de bord du jour.

## Le restaurant de démonstration

**AfriKaisse Demo Restaurant** sert à présenter le logiciel à un prospect, sans rien configurer.

- **Créer** : back-office AfriKaisse (**Administration → Plateforme → Démonstration**), ou sur le
  serveur : `node dist/cli.cjs create-demo` (e-mail du propriétaire en option).
- **Contenu** : 20 tables (12 en salle, 8 en terrasse) avec leurs QR, postes Cuisine, Bar et Grill, une
  carte de 25 plats tchadiens et ouest-africains avec photos et options, un compte par métier (gérant,
  caissier, deux serveurs, cuisine, bar, magasinier), 14 jours de ventes (espèces, mobile money,
  carte, quelques annulations, caisses clôturées chaque soir) et le service du jour en cours : une
  commande QR à confirmer, une en cuisine, une prête, une servie avec l'addition demandée.
- **Identifiants** : les mots de passe sont générés et affichés **une seule fois** à la création.
  Ils ne sont enregistrés nulle part en clair. Les adresses se terminent par `@demo.afrikaisse.invalid` :
  aucun e-mail ne peut y partir.
- La démonstration est une organisation à part, marquée « Démonstration », isolée comme n'importe quel
  client et sans échéance d'abonnement. Les ventes y sont passées par les vrais écrans du logiciel
  (caisse, cuisine, encaissement), datées sur les 14 derniers jours.

Dans une organisation ordinaire, **POST /locations/{id}/demo** (établissement vide) n'installe que la
configuration : salle, postes et carte, sans équipe ni vente.

## Se connecter

Adresse e-mail et mot de passe. Après 5 erreurs de suite, la connexion est bloquée 15 minutes.

Si vous travaillez pour plusieurs organisations, AfriKaisse vous demande laquelle ouvrir. Vous
pouvez changer à tout moment : cliquez sur votre nom, en haut à droite.

## La tablette

1. Installer l'application **AfriKaisse** sur la tablette Android et l'ouvrir.
2. **Connexion au serveur** :
   - *AfriKaisse Cloud* si le restaurant travaille par Internet ;
   - *Serveur local du restaurant* si un PC AfriKaisse est installé : saisir l'adresse affichée sur
     ce PC (par exemple `192.168.1.20:7300`). La tablette doit être sur le **même Wi-Fi**.
3. **Tester la connexion**, puis **Utiliser ce serveur** : le bouton ne s'active qu'une fois le
   serveur trouvé.
4. Se connecter avec son e-mail et son mot de passe. La tablette reste connectée même après
   redémarrage ; **Se déconnecter** efface la session de la tablette.

Pour changer de serveur : se déconnecter, puis **Changer** en bas de l'écran de connexion.

Une adresse Internet en `http://` est refusée : hors du Wi-Fi du restaurant, la connexion doit être
chiffrée (`https://`).

## Les établissements

Menu **Établissements** (propriétaire, administrateur).

- **Nouvel établissement** : nom, type, pays (préremplit fuseau et devise), adresse, téléphone.
- **Début de journée** : les ventes faites avant cette heure comptent pour la veille. À régler à la
  fin du service de nuit (05:00 par défaut).
- **Mode d'exploitation** :
  - *Cloud* : tout passe par Internet, sans PC sur place ;
  - *Serveur local* : le PC du restaurant fait tourner AfriKaisse, qui continue sans Internet.
- **Addition** :
  - *Une addition pour la table* : les clients voient et demandent l'addition de toute la table ;
  - *Une addition par client* : chaque téléphone voit sa part et demande sa propre addition.
- **Code de table** : coché, un client ne peut commander par QR qu'avec le code à 4 chiffres de sa
  table, donné par le serveur. Une photo du QR ne permet plus de commander depuis chez soi.
- **Archiver** : l'établissement disparaît des écrans de travail, son historique est gardé, et on peut
  le **réactiver**. Impossible pour le dernier établissement actif, ou si des membres ne travaillent
  que là (réaffectez-les d'abord depuis **Personnel**).

## Les tables (plan de salle)

Menu **Tables**. Pensé pour la tablette : tout se fait au doigt.

1. **Nouvelle zone** : Salle, Terrasse, VIP… avec la taille du plan en cases (24 × 16 par défaut ;
   une table de 2 à 4 personnes occupe 2 × 2 cases).
2. **Nouvelle table** : libellé (T1, T2… proposé automatiquement), nombre de places, forme. La table
   se place seule sur la première place libre.
3. **Disposer** : faites glisser les tables au doigt, ou touchez-en une et poussez-la case par case
   avec les flèches. **Pivoter** tourne une table rectangulaire. Une table en rouge chevauche une autre
   table ou sort du plan : **Enregistrer le plan** reste grisé tant qu'il en reste. **Annuler** remet
   le plan comme avant.
4. Toucher une table affiche sa fiche (places, forme, position). **Modifier la table** permet aussi
   de la changer de zone.

Les serveurs et caissiers consultent le plan sans pouvoir le modifier.

### Le plan en service
Hors mode « Disposer », le plan est **vivant**. Il se met à jour tout seul, et les serveurs arrivent directement dessus.

| Couleur | Signification |
|---|---|
| Gris | Table libre |
| Bleu | Table occupée (minutes depuis l'arrivée) |
| Vert | Une commande est **prête** en cuisine (badge « Prêt ») |
| Orange, qui pulse | Appel serveur, **addition demandée** ou commande **QR à confirmer** (badge) |
| Pointillés verts | Tout est réglé, les clients sont encore là |

Toucher une table ouvre sa **fiche de service** :
- **Confirmer** une commande QR, **Servie** pour une commande prête, **Traité** pour un appel ;
- l'addition en cours : commandes, total, déjà payé, reste ;
- **Nouvelle commande** : la prise de commande s'ouvre en plein écran pour cette table, puis **Envoyer la commande** ;
- **Encaisser** (caissier, responsable), **Imprimer l'addition**, **Changer de table**, **Libérer la table**.
- chaque commande QR porte le **prénom** du client (ou « Client 2 ») ; une **addition demandée** indique
  qui la demande, le **moyen de paiement choisi** (espèces, Mobile Money, carte) et le montant : venez
  avec le terminal ou la monnaie ;
- en addition par client, le tableau des **parts** montre ce que chacun doit.

**Code de table** (si l'option est cochée pour l'établissement) :
1. À l'arrivée des clients, touchez la table libre puis **Ouvrir la table** : le code à 4 chiffres
   s'affiche en haut de la fiche.
2. Donnez le code aux clients. Chaque téléphone le saisit une fois, avant sa première commande.
3. **Nouveau code** si le code a circulé : les clients déjà installés ne sont pas déconnectés.
4. Le code figure aussi sur l'addition imprimée et dans la **Caisse** (onglet Encaissement).

Une table ouverte sans commande se libère avec **Libérer la table**. Après 10 codes faux en
10 minutes, la table refuse tout code pendant 10 minutes.

## Le menu

Menu **Menu** : Produits, Options, Postes, Imprimantes, QR codes, Taxes et promotions.

### Produits
- À gauche, les **catégories** : ➕ créer, ✎ renommer ou masquer (une catégorie masquée reste
  gérée mais n'apparaît pas sur le menu client), ↑ ↓ changer l'ordre, archiver (seulement si vide).
- À droite, les **produits** de la catégorie. **Nouveau produit** ouvre la fiche :
  - nom, description, étiquettes (« Nouveau, Épicé »), temps de préparation ;
  - **prix** et **prix promotionnel** (laisser vide sans promotion) ;
  - **photo** : prise ou choisie sur l'appareil, réduite automatiquement avant l'envoi ;
  - **versions** (33 cl / 1 litre, Simple / Double) avec leur supplément ;
  - **groupes d'options** à cocher (Cuisson, Sauces…) ;
  - **allergènes** (les 14 à déclaration obligatoire).
- **Épuisé / Disponible** : un toucher pendant le service. La cuisine, le bar et la caisse peuvent le
  faire ; le client voit aussitôt « Épuisé » sur son menu.

### Importer des plats
**Importer des plats** (propriétaire, administrateur, gérant) évite de saisir la carte à la main.
1. Choisir le **pays** : l'onglet « Vendus au … » propose les plats courants de ce pays ; les autres
   onglets regroupent l'Afrique centrale, de l'Ouest, du Nord, de l'Est et du Sud, la cuisine du monde
   et le fast-food, les boissons, les desserts et le petit-déjeuner.
2. Toucher les plats que vous vendez. Chaque carte montre le **nom**, le **prix indicatif** dans votre
   devise, une **courte description** et la **photo**. Décocher **Disponible** pour importer un plat
   sans le proposer tout de suite.
3. **Importer** : les catégories manquantes (Plats, Grillades, Boissons…) sont créées, puis les plats
   arrivent avec leur photo.

Les plats déjà présents dans votre menu sont grisés et jamais importés deux fois. **Vérifiez les
prix** après l'import : ce sont des prix courants, pas les vôtres. Les photos du catalogue sont libres
de droits (domaine public ou CC0).

### Options
Les groupes d'options se créent une fois et servent à plusieurs produits.
- **Choix minimum 1, maximum 1** : un choix obligatoire (Cuisson).
- **Minimum 0** : facultatif (Suppléments, jusqu'au maximum indiqué).
- Chaque option a son supplément (0 si gratuit). Touchez un groupe pour marquer une option épuisée.

### QR codes
Chaque table du plan de salle a son QR.
- **Imprimer les QR** (depuis un ordinateur) : une planche A4, trois étiquettes par ligne, avec le nom
  de l'établissement et le numéro de table.
- **Régénérer le QR** si une photo du QR circule ou si l'étiquette est abîmée : l'ancien cesse
  aussitôt de fonctionner, il faut coller le nouveau.
- Une table archivée n'ouvre plus de menu.
- **Le client n'a besoin d'aucun Wi-Fi** : le QR mène à AfriKaisse Cloud, il scanne avec les données
  mobiles de son téléphone. C'est vrai aussi pour les QR imprimés depuis le PC du restaurant, dès que
  ce serveur local est relié au Cloud. Un serveur local **non relié** ne peut produire que des QR du
  réseau du restaurant : l'écran le signale en orange avant l'impression.

### Taxes et promotions
Onglet **Taxes et promotions** (propriétaire, administrateur et gérant modifient ; les autres consultent).

**Taxes**
- **Prix du menu** : **TVA incluse** (par défaut, le prix affiché est payé tel quel, la TVA est
  indiquée sur le reçu) ou **Hors taxe** (la TVA s'ajoute au total).
- **Nouveau taux** : nom et pourcentage (TVA 18 %, TVA 19,25 %, Exonéré 0 %). Cocher **Par défaut**
  pour l'appliquer à tout le menu.
- **Taux par catégorie et produit** : un taux différent pour une catégorie (Boissons à taux réduit)
  ou pour un seul produit. « Par défaut » et « Comme la catégorie » reprennent le taux hérité.
- Changer un taux ne modifie pas les commandes déjà passées.

**Promotions**
- **Nouvelle promotion** :
  - **Remise** : pourcentage, montant fixe (par article, ou sur la commande) ou **article offert**
    (2 achetés + 1 offert) ;
  - **Portée** : toute la commande (avec une commande minimale), une catégorie ou un produit ;
  - **Code promo** : laisser vide pour une promotion automatique ; sinon le client ou le caissier
    saisit le code (majuscules ou minuscules) ;
  - **Dates**, **Jours**, **Heures** : une happy hour de 18:00 à 20:00 le vendredi, une offre du mois ;
  - **Utilisations max.** : une commande annulée rend son utilisation.
- **Suspendre / Reprendre** l'arrête sans la perdre ; **Archiver** la retire et libère son code.
- **État** : En cours, Programmée, Suspendue, Terminée.

Quand plusieurs promotions visent la même ligne, la plus avantageuse pour le client s'applique.
Ensuite viennent la promotion de commande, le code promo (un seul par commande), la remise d'un
responsable, puis les taxes. Un produit à prix promotionnel ne reçoit pas d'autre promotion d'article.

## Le menu client (QR)

Le client scanne le QR de sa table avec l'appareil photo de son téléphone : le menu s'ouvre, sans
application ni compte. Il voit le nom du restaurant et le numéro de sa table, peut chercher un plat,
parcourir les catégories, et toucher un plat pour voir sa photo, sa description, ses versions,
options et allergènes. Les articles épuisés restent visibles, marqués « Épuisé ».

### Commander depuis le téléphone
1. Toucher un plat, choisir la version et les options : les choix obligatoires (Cuisson…) sont
   indiqués, et **Ajouter** reste grisé tant qu'ils manquent. Le prix se met à jour à chaque choix.
2. **Voir le panier** : changer les quantités, saisir un **code promo**, ajouter un mot pour le
   restaurant, puis **Commander**. Les promotions en cours sont affichées sur les plats (prix barré,
   « −20 % », « 2 + 1 offert ») et déduites dans le panier ; en mode hors taxe, la TVA s'y ajoute.
3. La commande part au restaurant, **qui la confirme**. Le client suit les étapes sur son
   téléphone : Envoyée, Confirmée, En cuisine, Prête, Servie.
4. **Appeler un serveur** prévient le personnel sur ses tablettes.

Si l'établissement fonctionne avec un serveur local injoignable, le téléphone affiche « commande en
ligne momentanément indisponible » : le client commande alors auprès d'un serveur.

### Plusieurs clients à la même table
Chacun scanne le même QR avec son téléphone et commande de son côté. **Ma table** montre les
personnes installées, toutes les commandes de la table (avec le prénom de qui a commandé) et leur
avancement. Le prénom est facultatif. Si l'établissement exige le **code de table**, le téléphone le
demande une fois (champ « Code de table » du panier ou de « Ma table »), puis s'en souvient pour ce
repas.

### Payer
Le paiement en ligne n'est pas disponible : **Payer** montre le reste à payer (la table, ou sa part en
addition par client), le client choisit **Espèces**, **Mobile Money** ou **Carte**, puis **Demander
l'addition**. Le serveur arrive avec l'addition et le bon moyen d'encaissement.

### Populaires, favoris, langue
- **Populaires** : les plats les plus commandés ces 30 derniers jours dans ce restaurant (ventes
  réelles). La section n'apparaît qu'avec assez de ventes.
- **Favoris** : l'étoile d'un plat le garde en tête du menu, sur ce téléphone seulement.
- **Langue** : français, anglais ou arabe (écriture de droite à gauche). Les noms des plats restent
  ceux saisis par le restaurant.

### Sans connexion
Le menu déjà ouvert une fois reste **consultable sans Internet** (photos vues comprises), et peut être
ajouté à l'écran d'accueil du téléphone comme une application. Hors connexion, la commande est
coupée : « Commande indisponible hors connexion, appelez un serveur ».

## Les commandes (personnel)

Menu **Commandes**, ouvert par défaut pour le personnel de salle.
- Les nouvelles commandes QR arrivent seules, en quelques secondes, avec un **signal sonore** (après
  un premier toucher sur l'écran, exigé par les navigateurs) et une pastille rouge sur l'onglet.
- Quatre colonnes, de gauche à droite : **À confirmer** (rouge), **En cuisine** (jaune), **Prêtes**
  (vert), **Servies · à encaisser** (bleu). Chaque commande est une carte : numéro, table, temps écoulé
  (en rouge quand elle attend trop), articles, et un bouton pour l'étape suivante.
- Toucher une carte ouvre son détail : plats, options, remarques du client, total, historique.
- Les boutons suivent le service : **Confirmer** ou **Refuser** (commande QR), **En préparation**,
  **Prête**, **Servie**, **Terminer**. Chacun ne voit que les boutons de son rôle.
- **Annuler** une commande déjà partie en cuisine est réservé aux responsables, avec un motif
  obligatoire, inscrit au journal.
- **Appels des tables** : « Table 4 — Demande l'addition », bouton **Traité**.
- **Tables à libérer** : quand toutes les commandes d'une table sont terminées, **Libérer**.

## La caisse

Menu **Caisse** (propriétaire, administrateur, gérant, caissier). Le caissier arrive directement dessus.

### Ouvrir la caisse
Onglet **Caisse** :
1. compter les espèces du tiroir ;
2. saisir le **fond de caisse** ;
3. toucher **Ouvrir la caisse**.

Sans caisse ouverte, aucun encaissement n'est possible.

### Vendre
Onglet **Vente**.
- Catégories à gauche, produits au centre, **ticket toujours visible** à droite.
- Toucher un produit l'ajoute. S'il a des versions ou options (« Options… »), une fenêtre s'ouvre :
  - la première version disponible est déjà choisie ;
  - les choix obligatoires sont indiqués ;
  - **Ajouter** montre le prix exact.
- **− / +** changent la quantité.
- **Sur place** : choisir la table, ou « Sans table » pour le comptoir. **À emporter** : nom du client.
- Les promotions en cours se déduisent seules, ligne par ligne. **Code promo** (icône ticket) :
  saisir le code du client ; le ticket affiche sous-total, promotions, taxes et total.
- **Envoyer la commande** : la commande part en préparation, l'addition reste ouverte.
- **Envoyer et encaisser** : le client paie tout de suite.

### Encaisser
Onglet **Encaissement** : les notes ouvertes (tables occupées, commandes à emporter, commandes restées impayées).
1. Toucher une note : détail des commandes, total, déjà payé, reste.
2. **Remise** (responsables) : 5 %, 10 %… ou « Offert », avec un motif inscrit au journal. Elle
   porte sur le montant après promotions ; les taxes sont recalculées.
3. **Encaisser** :
   - choisir **Espèces**, **Mobile money**, **Carte** ou **Autre** ;
   - le montant proposé est le reste à payer, ou une part de l'addition partagée (**1/2**, **1/3**, **1/4**) ;
   - en espèces, toucher la somme remise (10 000…) : la **monnaie à rendre** s'affiche ;
   - en mobile money, noter l'opérateur et le numéro de transaction.
4. Le **reçu** s'affiche. Depuis un ordinateur, **Imprimer** sort un ticket 80 mm.

Plusieurs paiements sur une même table sont répartis sur les commandes, la plus ancienne d'abord.
- Une commande **payée et servie se termine seule**.
- Une table **entièrement réglée se libère seule**.
- **Changer de table** déplace les clients. Vers une table occupée, les deux additions sont regroupées.
- **Imprimer l'addition** sort la note à présenter au client (ce n'est pas un reçu).

### Suivre et clôturer
Onglet **Caisse**.
- En direct : encaissements par mode, entrées et sorties, **espèces attendues**.
- **Entrée / Sortie d'espèces** : apport de monnaie, achat réglé en espèces… toujours avec un motif.
- Toucher un paiement : **Voir le reçu**, ou **Annuler le paiement** (responsables, avec motif). Les commandes redeviennent à encaisser.
- **Rapport X** : point de caisse sans clôturer.
- **Clôturer la caisse** :
  1. compter le tiroir et saisir les espèces comptées ;
  2. l'**écart** s'affiche ;
  3. la clôture fige le **rapport Z**.

  Après la clôture, plus aucun paiement de cette caisse ne peut être annulé.
- **Sessions précédentes** : rouvrir le rapport Z de chaque journée.

## La cuisine et le bar

### Les postes
Menu **Menu**, onglet **Postes**.
- Chaque établissement démarre avec deux postes : **Cuisine** et **Bar**.
- Vous pouvez en ajouter (Grill, Pâtisserie, Bar terrasse…). Le **type** décide qui peut les faire avancer : l'équipe cuisine pour « Cuisine », l'équipe du bar pour « Bar ».
- Dans la fiche d'un produit, **Poste de préparation** indique où il part. Sans choix, il part au premier poste Cuisine.
- Un poste qui a encore des produits ne peut pas être archivé : affectez-les d'abord à un autre poste.

### L'écran cuisine
Menu **Cuisine** : cuisiniers et barmen arrivent directement dessus.
- En haut, choisir **son poste**. Le choix reste mémorisé sur la tablette. « Tous mes postes » affiche tout ce qu'on a le droit de voir.
- Trois colonnes : **À préparer**, **En préparation**, **Prêt**. Chaque ticket montre :
  - le numéro, la table (ou « À emporter ») et un **minuteur** depuis la confirmation. Le cadre devient orange quand le **temps de préparation** des plats (fiche produit, 15 min si vide) est dépassé, rouge quand le retard devient franc ;
  - les quantités en gros, les options et les remarques du client en jaune.
- **Commencer** puis **Prêt**. Un signal sonore annonce chaque nouveau ticket.
- **Rappeler** remet un ticket en préparation (erreur de manipulation), tant que la commande n'est pas annoncée prête en salle.
- Quand **tous les postes** d'une commande ont fini, elle passe « Prête » sur l'écran Commandes des serveurs.
- Les commandes QR n'arrivent en cuisine qu'une fois **confirmées** par la salle.
- **Problème** : choisir le motif (produit manquant, retard important, commande incomplète, question) et, si besoin, une précision. La salle et la caisse sont prévenues par une notification.
- **Plein écran** masque tout le reste sur une tablette murale.

## Les imprimantes de tickets

Menu **Menu**, onglet **Imprimantes** (propriétaire, administrateur, gérant). Pour les imprimantes
thermiques **réseau** (Epson, Xprinter…), branchées sur la box du restaurant, avec le **serveur
AfriKaisse installé sur le PC** du restaurant.

1. **Nouvelle imprimante** : nom, adresse IP (l'imprimante l'imprime souvent si l'on maintient le bouton d'avance papier à l'allumage), papier 80 ou 58 mm.
2. Cocher **tickets de préparation** et choisir le **poste** (Cuisine, Bar, Grill…, ou tous), et/ou **reçus de la caisse**.
3. **Imprimer un test** : le ticket doit sortir avec les accents corrects.

Ensuite :
- **Tickets de préparation** : chaque commande confirmée sort toute seule sur l'imprimante de chaque poste concerné, avec le numéro, la table, les options et les remarques en gras.
- **Reçus** : à l'encaissement, **Imprimante de caisse** envoie le reçu.
- **File d'impression** : elle montre ce qui est sorti et ce qui a échoué (imprimante éteinte, papier…). **Relancer** renvoie le ticket.

Sans serveur local (tout dans le Cloud), le bouton **Imprimer** depuis un ordinateur sort le même
ticket au format 80 mm par le navigateur.

## Le stock

Menu **Stock** (propriétaire, administrateur, gérant, magasinier).

### Articles
- **Nouvel article** : poulet (pièce), riz (kg), huile (l), bière 65 cl (pièce)… avec un **seuil d'alerte** et un coût.
- **Réception** à chaque livraison : quantité et coût. Le dernier coût devient la référence.
- **Inventaire** : saisir ce qui a été compté ; AfriKaisse enregistre l'écart.
- **Perte** (périmé, cassé) et **Sortie** : toujours avec un motif.
- Le stock n'est jamais tapé à la main : il découle des mouvements. Toucher un article affiche son historique, ventes comprises, avec leur numéro de commande.
- État **Bas** sous le seuil, **Épuisé** à zéro ; l'onglet affiche le nombre d'articles à réapprovisionner.

### Recettes
Onglet **Recettes** : choisir un plat, puis ajouter ses ingrédients.
- Exemple : poulet yassa = 1 poulet et 0,2 kg de riz.
- Pour une boisson en plusieurs formats, une ligne par **version** : bissap 33 cl = 0,33 l, 1 litre = 1 l.
- Le **coût matière estimé** et sa part du prix de vente s'affichent.

Pendant le service :
- **Déduction** : chaque commande confirmée déduit sa recette ; une commande annulée la rend.
- **Rupture** : quand un ingrédient ne suffit plus pour une portion, le plat passe **épuisé** tout seul, sur la caisse comme sur le menu QR.
- **Réapprovisionnement** : il revient à la réception suivante. Un plat épuisé à la main reste épuisé.

## Le tableau de bord

Menu **Tableau de bord** (propriétaire, administrateur, gérant).
- **Période** : Aujourd'hui, Hier, 7 jours, 30 jours, Ce mois, ou deux dates au choix. Les dates sont
  des **journées d'exploitation** : une vente à 2 h du matin compte pour la veille.
- **Indicateurs** : chiffre d'affaires, encaissé, commandes, ticket moyen, articles vendus, remises,
  annulées.
- **Ventes par jour**, **heures de service** (les heures de pointe), **modes de paiement** avec leur
  part, **origine** (QR, caisse, serveur) et **type de service**, **produits les plus vendus**.
- **Exporter (CSV)** depuis un ordinateur : le fichier s'ouvre directement dans Excel.

Le chiffre d'affaires compte les commandes confirmées, payées ou non ; « Encaissé » compte l'argent
réellement reçu. L'écart entre les deux, ce sont les additions encore ouvertes.

## Les rapports

Menu **Rapports** (propriétaire, administrateur, gérant).
- **Période** : Aujourd'hui, Hier, 7 jours, 30 jours, Ce mois, Cette année, ou deux dates.
- **Onglets** :
  - **Ventes** : l'essentiel de la période et l'écart avec la période précédente ;
  - **Périodes** : par jour, par semaine ou par mois (rapports journalier, hebdomadaire, mensuel ; « Cette année » + « Mois » = rapport annuel) ;
  - **Produits**, **Catégories** : quantités, montants et part de chacun ;
  - **Personnel** : commandes et chiffre d'affaires de chaque membre (la commande QR compte pour qui l'a confirmée), encaissements ;
  - **Paiements** : par mode, par jour, paiements annulés ;
  - **Cuisine** : temps moyen de préparation (de la confirmation à « prête »), temps par poste et par produit comparé au temps prévu, tickets en retard ;
  - **Stock** (avec le droit de voir le stock) : début, réceptions, consommation, pertes, inventaires, fin de période, en quantité et en valeur.
- **Exporter** : fichier CSV qui s'ouvre dans Excel. **Imprimer** : feuille A4 avec l'en-tête de l'établissement ; choisir « Enregistrer au format PDF » pour obtenir un PDF. Ces deux boutons sont sur ordinateur, pas sur la tablette.

Sur le **tableau de bord**, « Temps moyen » donne le temps de préparation du jour et le nombre de commandes en retard.

## Les notifications

La **cloche** en haut de l'écran compte les notifications non lues.
- La salle et la caisse reçoivent : nouvelle commande QR, commande prête, appel d'un serveur, addition demandée, problème signalé par la cuisine. Un signal court retentit pour ces alertes.
- Qui gère le stock reçoit : stock faible et rupture.
- On ne reçoit pas la notification de son propre geste (le serveur qui annonce une commande prête, par exemple).
- Toucher une notification la marque lue et ouvre l'écran concerné (Commandes ou Stock). **Tout marquer lu** vide le compteur.
- Chaque personne a ses propres notifications lues ; elles restent 3 jours dans la liste.

## Installer AfriKaisse sur le PC du restaurant (sans Internet)

1. Lancer **AfriKaisse-Setup.exe** sur le PC du comptoir (Windows 10 ou 11, 64 bits), avec un compte
   administrateur. Si Windows affiche « Windows a protégé votre PC » : **Informations complémentaires**, puis
   **Exécuter quand même**.
2. À la fin, AfriKaisse s'ouvre : **Créer mon restaurant**.
3. **Appairer une tablette** (voir « Le logiciel Windows ») : saisir l'adresse affichée dans l'application
   tablette, écran « Connexion au serveur », option « Serveur local du restaurant ».
4. Conseil : demander au fournisseur d'accès de **réserver l'adresse IP** du PC sur la box, pour que
   l'adresse des tablettes ne change jamais.

Les données restent sur le PC (`C:\ProgramData\AfriKaisse`), même si l'on désinstalle le logiciel.

### Le logiciel Windows

Le **serveur AfriKaisse démarre avec le PC**, avant même qu'on ouvre une session Windows : les tablettes, la
cuisine et les imprimantes fonctionnent dès que le PC est allumé. S'il s'arrête, il repart seul.

La **console** est l'icône AfriKaisse à côté de l'horloge (zone de notification ; au besoin, flèche ^). Clic sur
l'icône : la caisse. Clic droit :

| Menu | Effet |
|---|---|
| Ouvrir la caisse | L'application en plein écran (F11 : plein écran, F5 : recharger) |
| État du système | La **Supervision** (voir plus bas) dans sa propre fenêtre |
| Appairer une tablette | Un **QR code** et l'adresse du serveur (par exemple `192.168.1.20:7300`) ; s'il y a plusieurs adresses, choisir celle du Wi-Fi ou du câble du restaurant |
| Sauvegarder maintenant | Copie vérifiée de la base dans `C:\ProgramData\AfriKaisse\sauvegardes`, sans fermer la caisse ; un message indique le fichier |
| Démarrer avec Windows | Coché : l'icône apparaît à l'ouverture de session |
| Quitter la console | Ferme l'icône et les fenêtres ; **le serveur continue** de servir les tablettes |

La première ligne du menu dit si le serveur est en marche. S'il ne répond pas, la console le relance et
patiente ; au-delà d'une minute et demie, elle affiche **Réessayer** et **Ouvrir les journaux** (à transmettre
au support).

L'icône **AfriKaisse dans le navigateur** du menu Démarrer ouvre la même application dans le navigateur.

**Relier le PC au Cloud** (pour suivre le restaurant à distance, et proposer la commande QR en ligne) :
1. Dans AfriKaisse Cloud (navigateur, avec Internet), menu **Établissements** : choisir l'établissement, puis **Relier un serveur local**. Un code s'affiche, par exemple `K7QM-3XRA`, valable 10 minutes.
2. Sur le PC où AfriKaisse vient d'être installé, écran de connexion : **Relier à AfriKaisse Cloud**, saisir le code.
3. L'équipe, la salle, la carte, le stock et les imprimantes arrivent sur le PC. On se connecte avec son compte habituel.

Ensuite, la synchronisation est automatique, toutes les 5 secondes :
- les ventes, la caisse et le stock du restaurant remontent au Cloud (tableau de bord à distance) ;
- les changements faits en ligne (prix, carte, équipe) descendent au PC.

Sans Internet, le restaurant travaille normalement ; tout part au retour de la connexion. Le menu
**Paramètres** montre l'état de la liaison et propose **Synchroniser maintenant**.

**Sauvegardes** : AfriKaisse copie et vérifie sa base au démarrage puis toutes les heures, dans
`C:\ProgramData\AfriKaisse\sauvegardes`. Le menu **Paramètres** montre les dernières copies, avec
**Sauvegarder maintenant**. Copiez ce dossier chaque semaine sur une clé USB : une panne du disque
emporterait aussi les copies. Pour revenir à une copie :
1. quitter AfriKaisse ;
2. remplacer `afrikaisse.sqlite` par la copie choisie ;
3. relancer.

**Mettre à jour AfriKaisse** : **Administration → Supervision**, cadre **Mise à jour**, affiche
« Version actuelle » et, s'il y en a une, « Nouvelle version », avec ses notes et **Télécharger**.
AfriKaisse n'installe jamais rien seul. Après le service :
1. clôturer la caisse ; attendre « 0 en attente » en synchronisation ;
2. télécharger, puis lancer l'installateur : il arrête AfriKaisse et copie la base dans
   `sauvegardes\avant-mise-a-jour` avant de remplacer le logiciel ;
3. rouvrir AfriKaisse : la Supervision affiche la nouvelle version.

## La supervision

**Administration → Supervision** (propriétaire, administrateur, gérant), actualisée toutes les 15 secondes :

- en haut : **État du système**, **Dernière sauvegarde**, **Dernière synchronisation** ;
- un cadre rouge liste ce qui est **en défaut** ;
- le tableau : Cloud, base de données, API, serveur local, synchronisation, imprimantes, écrans
  cuisine, sauvegarde, chacun avec son état et son dernier contact.

| Pastille | État |
|---|---|
| Verte | Normal |
| Jaune | À surveiller (retard, travaux d'impression en attente, conflits) |
| Rouge | En défaut |
| Grise | Non utilisé ici |

Un écran **Cuisine** ouvert se signale seul ; fermé depuis plus de 10 minutes, il passe en défaut.

## L'abonnement

**Administration → Paramètres** montre votre offre, son échéance, et ce que vous utilisez face à
ce qu'elle inclut.

| Offre | Prix | Établissements | Membres | Serveurs locaux |
|---|---|---|---|---|
| Essai gratuit (30 jours) | gratuit | 3 | 25 | 1 |
| Essentiel | 15 000 FCFA / mois | 1 | 8 | 1 |
| Pro | 35 000 FCFA / mois | 3 | 30 | 3 |
| Groupe | sur devis | illimité | illimité | illimité |

- Sept jours avant l'échéance, un rappel s'affiche en haut de l'écran du propriétaire et de
  l'administrateur.
- **À l'échéance, rien ne s'arrête** : caisse, cuisine, commandes QR et synchronisation continuent.
  Après 7 jours de grâce, seuls les ajouts (établissement, membre, serveur local) sont refusés
  jusqu'au renouvellement.
- Pour renouveler ou changer d'offre : GLOBALTECH BUSINESS TD (mobile money ou virement).

### Un PC du restaurant volé ou remplacé

**Gestion → Établissements**, sélectionnez l'établissement, **Serveurs reliés**, puis
**Révoquer** : ce PC ne peut plus rien envoyer ni recevoir. **Relier un serveur local** donne
ensuite le code du PC de remplacement.

## Le personnel

Menu **Personnel** (propriétaire, administrateur, gérant).

| Rôle | Peut |
|---|---|
| Propriétaire | Tout, y compris l'abonnement |
| Administrateur | Tout sauf l'abonnement |
| Gérant | Personnel (rôles inférieurs), menu, tables, commandes, remises, caisse, stock, rapports |
| Caissier | Caisse, commandes, encaissement |
| Serveur | Tables et prise de commande |
| Cuisine / Bar | Écran de préparation de sa station |
| Magasinier | Stock |

- **Ajouter un membre** : nom, e-mail, rôle, établissement (ou tous), mot de passe initial. Si la
  personne a déjà un compte AfriKaisse, elle est simplement rattachée et garde son mot de passe.
- On ne peut donner qu'un rôle **inférieur** au sien (un gérant ne crée pas d'administrateur).
- **Désactiver** : la personne perd l'accès **immédiatement**, sur tous ses appareils.
- **Nouveau mot de passe** : la personne est déconnectée partout. Impossible pour un « compte
  partagé » (rattaché aussi à une autre organisation) : seule la personne peut changer le sien.
- Personne ne peut modifier son propre rôle.

## Le journal

Menu **Journal** : connexions, ajouts et modifications de membres (avant/après), changements de mot
de passe, renommages. Il ne peut pas être modifié.

## Mon compte

Changer son mot de passe. Les autres appareils connectés sont déconnectés ; celui qu'on utilise
reste connecté.

## Langue et thème

En bas du menu : français, English, العربية ; thème clair, sombre ou celui du système.
