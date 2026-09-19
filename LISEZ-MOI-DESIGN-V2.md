# Design v2 : tableau de bord à l'écran, nuages, un seul bleu

À copier par-dessus le projet (mêmes chemins que dans C:\PROJETS\AFRIKAISSE), après la première archive « menu du jour ».

- Le tableau de bord tient dans l'écran (les listes défilent dans leur carte). Sur petit écran, il redéfile normalement.
- « Service en cours » supprimé : ses compteurs deviennent des étiquettes cliquables dans « Commandes en direct »
  (jaune = à confirmer, bleu = en cuisine, vert = prêtes, rouge = demandes de table).
- Fond de chaque widget : nuages doux, bleu (information), jaune (à traiter) ou rouge (urgent), automatiquement selon l'état
  (menu du jour : jaune sans menu, rouge s'il y a un plat épuisé ; commandes : jaune si à confirmer, rouge si demande de table ;
  temps cuisine : rouge si retards).
- Un seul bleu : #1d4ed8, identique pour les boutons, la barre latérale (rail), les icônes et les graphiques.

Pour revenir à une barre latérale sombre : dans apps/web/src/styles/v3.css, remplacer la ligne
`background: linear-gradient(180deg, var(--bleu) 0%, var(--bleu-nuit) 100%);` du `.tablette .rail`
par `background: linear-gradient(180deg, var(--nuit) 0%, var(--nuit2) 100%);`.
