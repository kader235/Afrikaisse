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

Dans cette version, le client consulte le menu et **commande auprès d'un serveur**. La commande
depuis le téléphone arrive à l'étape suivante.

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
