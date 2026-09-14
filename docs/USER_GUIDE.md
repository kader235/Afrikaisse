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

## Bien démarrer

Tant que l'établissement n'a ni table ni produit, AfriKaisse s'ouvre sur **Bien démarrer** (propriétaire, administrateur, gérant) :
1. dessiner la salle ;
2. composer la carte ;
3. ajouter l'équipe ;
4. ouvrir la caisse ;
5. prendre la première commande.

Chaque étape a son bouton, et une coche verte apparaît quand elle est faite.

**Essayer avec un restaurant de démonstration** installe en un geste :
- une salle et une terrasse, avec 10 tables et leurs QR codes ;
- une carte de 19 plats et boissons en 5 catégories (yassa, thiéboudienne, kissar, grillades, bissap…), avec options (cuisson, accompagnement, suppléments, piment) et allergènes ;
- un poste **Grill** en plus de la cuisine et du bar.

Pratique pour découvrir la caisse, l'écran cuisine et le menu client avant de saisir sa propre carte.
Elle ne s'installe que sur un établissement **vide**. Tout se modifie ou s'archive ensuite.

## Se connecter

Adresse e-mail et mot de passe. Après 5 erreurs de suite, la connexion est bloquée 15 minutes.

Si vous travaillez pour plusieurs organisations, AfriKaisse vous demande laquelle ouvrir. Vous
pouvez changer à tout moment depuis le sélecteur sous le nom de l'organisation.

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
- **Archiver** : l'établissement disparaît des écrans de travail, son historique est gardé, et on peut
  le **réactiver**. Impossible pour le dernier établissement actif, ou si des membres ne travaillent
  que là (réaffectez-les d'abord depuis **Équipe**).

## Le plan de salle

Menu **Plan de salle**. Pensé pour la tablette : tout se fait au doigt.

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

## Le menu

Menu **Menu**, trois onglets.

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

## Le menu client (QR)

Le client scanne le QR de sa table avec l'appareil photo de son téléphone : le menu s'ouvre, sans
application ni compte. Il voit le nom du restaurant et le numéro de sa table, peut chercher un plat,
parcourir les catégories, et toucher un plat pour voir sa photo, sa description, ses versions,
options et allergènes. Les articles épuisés restent visibles, marqués « Épuisé ».

### Commander depuis le téléphone
1. Toucher un plat, choisir la version et les options : les choix obligatoires (Cuisson…) sont
   indiqués, et **Ajouter** reste grisé tant qu'ils manquent. Le prix se met à jour à chaque choix.
2. **Voir le panier** : changer les quantités, ajouter un mot pour le restaurant, puis **Commander**.
3. La commande part au restaurant, **qui la confirme**. Le client suit les étapes sur son
   téléphone : Envoyée, Confirmée, En cuisine, Prête, Servie.
4. **Appeler un serveur** et **Demander l'addition** préviennent le personnel sur ses tablettes.

Si l'établissement fonctionne avec un serveur local injoignable, le téléphone affiche « commande en
ligne momentanément indisponible » : le client commande alors auprès d'un serveur.

## Les commandes (personnel)

Menu **Commandes**, ouvert par défaut pour le personnel de salle.
- Les nouvelles commandes QR arrivent seules, en quelques secondes, avec un **signal sonore** (après
  un premier toucher sur l'écran, exigé par les navigateurs) et une pastille rouge sur l'onglet.
- Filtres **À confirmer**, **En cours**, **Prêtes**.
- Toucher une commande affiche son détail : plats, options, remarques du client, total, historique.
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
- **Envoyer la commande** : la commande part en préparation, l'addition reste ouverte.
- **Envoyer et encaisser** : le client paie tout de suite.

### Encaisser
Onglet **Encaissement** : les notes ouvertes (tables occupées, commandes à emporter, commandes restées impayées).
1. Toucher une note : détail des commandes, total, déjà payé, reste.
2. **Remise** (responsables) : 5 %, 10 %… ou « Offert », avec un motif inscrit au journal.
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
  - le numéro, la table (ou « À emporter ») et un **minuteur** depuis la confirmation, orange après 15 min et rouge après 25 min ;
  - les quantités en gros, les options et les remarques du client en jaune.
- **Commencer** puis **Prêt**. Un signal sonore annonce chaque nouveau ticket.
- **Rappeler** remet un ticket en préparation (erreur de manipulation), tant que la commande n'est pas annoncée prête en salle.
- Quand **tous les postes** d'une commande ont fini, elle passe « Prête » sur l'écran Commandes des serveurs.
- Les commandes QR n'arrivent en cuisine qu'une fois **confirmées** par la salle.
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

## Installer AfriKaisse sur le PC du restaurant (sans Internet)

1. Lancer **AfriKaisse-Setup.exe** sur le PC du comptoir (Windows 10 ou 11, 64 bits). Si Windows
   affiche « Windows a protégé votre PC » : **Informations complémentaires**, puis **Exécuter quand même**.
2. Laisser cochés **Démarrer le serveur AfriKaisse à l'ouverture de session** et l'icône sur le Bureau.
3. À la fin, AfriKaisse s'ouvre dans le navigateur : **Créer mon restaurant**.
4. En bas de l'écran, **Adresse pour les tablettes** (par exemple `192.168.1.20:7300`) : la saisir dans
   l'application tablette, écran « Connexion au serveur », option « Serveur local du restaurant ».
5. Conseil : demander au fournisseur d'accès de **réserver l'adresse IP** du PC sur la box, pour que
   l'adresse des tablettes ne change jamais.

Les données restent sur le PC (`C:\ProgramData\AfriKaisse`), même si l'on désinstalle le logiciel.

**Relier le PC au Cloud** (pour suivre le restaurant à distance, et proposer la commande QR en ligne) :
1. Dans AfriKaisse Cloud (navigateur, avec Internet), menu **Établissements** : choisir l'établissement, puis **Relier un serveur local**. Un code s'affiche, par exemple `K7QM-3XRA`, valable 10 minutes.
2. Sur le PC où AfriKaisse vient d'être installé, écran de connexion : **Relier à AfriKaisse Cloud**, saisir le code.
3. L'équipe, la salle, la carte, le stock et les imprimantes arrivent sur le PC. On se connecte avec son compte habituel.

Ensuite, la synchronisation est automatique, toutes les 5 secondes :
- les ventes, la caisse et le stock du restaurant remontent au Cloud (tableau de bord à distance) ;
- les changements faits en ligne (prix, carte, équipe) descendent au PC.

Sans Internet, le restaurant travaille normalement ; tout part au retour de la connexion. Le menu
**Organisation** montre l'état de la liaison et propose **Synchroniser maintenant**.

**Sauvegardes** : AfriKaisse copie et vérifie sa base au démarrage puis toutes les heures, dans
`C:\ProgramData\AfriKaisse\sauvegardes`. Le menu **Organisation** montre les dernières copies, avec
**Sauvegarder maintenant**. Copiez ce dossier chaque semaine sur une clé USB : une panne du disque
emporterait aussi les copies. Pour revenir à une copie :
1. quitter AfriKaisse ;
2. remplacer `afrikaisse.sqlite` par la copie choisie ;
3. relancer.

## L'équipe

Menu **Équipe** (propriétaire, administrateur, gérant).

| Rôle | Peut |
|---|---|
| Propriétaire | Tout, y compris l'abonnement |
| Administrateur | Tout sauf l'abonnement |
| Gérant | Équipe (rôles inférieurs), menu, tables, commandes, remises, caisse, stock, rapports |
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
