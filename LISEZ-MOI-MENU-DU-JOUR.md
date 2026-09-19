# Menu du jour + design bleu — mise en place

Les fichiers de ce dossier ont le même chemin que dans `C:\PROJETS\AFRIKAISSE`.

1. **Sauvegarder** le projet (commit Git ou copie), puis **copier tout le contenu** de ce dossier par-dessus le projet
   (les fichiers existants sont remplacés). `menu-du-jour.patch` montre ligne par ligne ce qui change (`git apply` possible).
2. Dans le projet : `npm run verify` (typecheck, tests, build). **Rien n'a pu être compilé ni testé de mon côté**
   (pas de dépendances installées dans mon environnement) : c'est la première chose à lancer. Envoie-moi les erreurs éventuelles.
3. Déploiement habituel (`DEPOSER-AFRIKAISSE.sh`) : la migration `0022_daily_menu` crée la table `daily_menus`
   après la sauvegarde automatique de la base.
4. Réactiver Tiger Protect en **excluant** `POST /api/` et `POST /api/public/` du sous-domaine `afrikaisse.dametta.com`
   (sinon les commandes des téléphones clients seront bloquées comme l'ont été celles de la tablette).

## Ce qui change
- **Menu du jour** (tableau de bord, widget en hauteur) : fixer le menu d'un jour ou d'une période, l'ajuster (mêmes dates =
  remplace), le retirer, marquer un plat épuisé / disponible. Sans menu du jour, toute la carte est proposée.
- **Menu client (QR)** : ne montre que les plats du menu du jour, grise « Épuisé », se met à jour seul (< 20 s).
  Le serveur refuse (409) un plat hors menu ou épuisé (commande et devis). La caisse n'est pas limitée par le menu du jour.
- **Synchronisation** : `daily_menus` est une donnée maître (Cloud ↔ serveur local), comme les annonces.
- **Design** : boutons principaux bleus partout (tablette/PC, cuisine, menu client, thèmes « bleu » et « nuit »),
  informations centrées dans les widgets, étiquettes colorées (bleu = en cours/info, jaune = attention, rouge = urgent, vert = terminé).
- **Widget retiré** : « Plats les plus vendus » (toujours dans Rapports). À remettre si tu préfères le garder.
