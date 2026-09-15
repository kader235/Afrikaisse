# AfriKaisse — design system « WEBDEV 28 »

Consigne de GLOBALTECH BUSINESS TD (15/09/2026) : un style **inspiré purement et profondément de WEBDEV 28**
(PC SOFT) — style, icônes, boutons — sur toutes les interfaces : web, tablette, téléphone et menu client.
AfriKaisse doit se lire comme une application WEBDEV soignée : un logiciel de gestion sérieux, pas un gabarit
de SaaS générique.

Tout le style de l'application vit dans `apps/web/src/styles.css` ; le menu client a le sien
(`src/menu/menu.css`). Les styles propres à une fonction vont dans `src/styles/<fonction>.css`.

## D'où viennent les valeurs

Relevé du 15/09/2026 (rapport complet : recherche WEBDEV 28). PC SOFT ne publie ni couleurs ni tailles : elles ont
été **lues dans les feuilles CSS que WEBDEV génère** sur des sites réels (ambiances Material Design 2 « BlueCloud »,
Phoenix « ColdWaveLight », iStyle, BlueVolution), et complétées par la documentation des nouveautés 28 (tables
aérées, libellé au-dessus du champ, 5000 cliparts, gabarit Eleven).

## Signature WEBDEV

1. **Bandeau bleu** `#065FD4` (Material Design 2) en haut de l'application, des fenêtres et de la fenêtre
   d'identification ; texte blanc.
2. **Roboto** (embarquée, licence OFL, fonctionne hors ligne), Segoe UI en secours ; texte 14 px sur PC.
3. **Boutons plats en capitales** (graisse 500), rayon 4 px, pictogramme à gauche. Bouton « cadre » bleu par
   défaut, bouton « plein » pour l'action principale ; survol = voile interne, jamais de dégradé.
4. **Icônes Material Design Icons** (Pictogrammers, Apache 2.0) — pleines, une couleur, grille 24 — la famille
   livrée avec WEBDEV.
5. **Champ Table** : en-tête gris `#F4F4F4` en gras, lignes zébrées `#F9F9F9`, sélection bleu pâle avec barre
   bleue de 3 px à gauche, montants alignés à droite.
6. **Onglets en capitales**, onglet actif souligné de 2 px bleu.
7. **Menu** : rubrique active en aplat bleu, texte blanc (inversion Material Design 2).
8. **Fenêtres** : barre de titre bleue, croix blanche, corps blanc, pied gris `#F8F8F8` avec les boutons à droite,
   action principale d'abord (VALIDER, puis ANNULER).
9. **Sections de fiche** : bande de titre grise en capitales.
10. **Barre d'état WINDEV** en bas (volets séparés d'un filet) : liaison, Cloud ou serveur local, établissement,
    utilisateur, date et heure, version — uniquement des informations réelles.
11. **Toast** sombre en bas de l'écran pour une réussite.

Consignes de Kader toujours valables : alertes sur fond blanc, texte rouge et triangle ; pas de texte d'orientation ;
pas de texte en couleur dans les tableaux (statut = texte neutre + pastille) ; pas de bandes de couleur décoratives
au-dessus des cadres (seules les barres de titre de fenêtre sont bleues, comme dans WINDEV).

## Couleurs

| Jeton | Clair | Sombre | Rôle WEBDEV |
| --- | --- | --- | --- |
| `--primary` | `#065FD4` | `#5B9BF0` | couleur principale (bandeau, boutons, sélection) |
| `--primary-hover` / `--primary-strong` | `#0658C4` / `#0550B3` | | survol / appui |
| `--primary-soft` | `#E8F0FC` | `#16263D` | ligne sélectionnée |
| `--primary-tonal` | bleu à 12 % | | voile de survol, bouton tonal |
| `--topbar` / `--topbar-brand` | `#065FD4` / `#0552B8` | `#0B3F8C` / `#093574` | bandeau, zone du logo |
| `--bg` | `#F4F4F4` | `#121417` | fond derrière les fiches |
| `--surface` | `#FFFFFF` | `#1B1E23` | fiches, tables, fenêtres |
| `--band` | `#F8F8F8` | `#22262C` | bandes de titre, barres d'outils, pieds de fenêtre |
| `--zebra` | `#F9F9F9` | `#1F2227` | lignes paires |
| `--grid-head` | `#F4F4F4` | `#22262C` | en-tête de table |
| `--line` / `--border` / `--border-strong` | `#E5E5E5` / `#D6D6D6` / `#BDBDBD` | | séparateurs, cadres, champs |
| `--text` / `--text-soft` / `--muted` | `#2D2D2D` / `#606060` / `#767676` | | textes |
| `--st-ok` / `--flag-gold` / `--flag-red` | `#5CB85C` / `#F0AD4E` / `#D9534F` | | pastilles d'état, jauges |
| `--danger` / `--ok` | `#C9302C` / `#3D8B3D` | | textes d'alerte et de réussite |
| `--statusbar` | `#E9E9E9` | `#181B1F` | barre d'état |

Le safran de la marque ne sert plus qu'au mot « Kaisse » du logo. L'écran cuisine reste sombre dans les deux thèmes.

## Typographie et tailles

| Rôle | PC | Au doigt (tablette) |
| --- | --- | --- |
| Texte courant | 14 px | 16–17 px |
| Titre de page | 22 px, 500 | 22 px (masqué sur les écrans de service) |
| Titre de widget / section | 14,5 px, 500 / 12,5 px capitales | 16 px |
| Boutons | 36 px, 13,5 px capitales | 50 px (principal de caisse 58–64 px) |
| Champs | 36 px, rayon 2 px, focus = cadre + soulignement bleu | 48 px, 16 px |
| Lignes de table | 42 px, en-tête 38 px | 58 px, en-tête 46 px |
| Bandeau / barre d'état | 50 px / 26 px | 56 px / 30 px |
| Icônes | 18 px (menu 22 px) | 20–24 px |

Rayons : 4 px (boutons, fiches, fenêtres), 2 px (champs, vignettes), 12 px (jetons de compteur).
Ombres Material : fiches `0 1px 3px rgba(0,0,0,.12)`, boutons pleins 2dp, fenêtres `0 3px 12px rgba(0,0,0,.36)`.

## Structure

- **Bandeau** : logo et nom, établissement et organisation, cloche des commandes à traiter, utilisateur.
- **Menu vertical** (240 px) : Tableau de bord ; Vente (Caisse, Commandes, Tables) ; Restauration (Cuisine, Menu) ;
  Gestion (Stock) ; Administration (Personnel, Rapports, Établissements, Paramètres, Journal…).
  Tablette : rail de 88 px, administration sous « Plus ». Téléphone : barre du bas + « Plus ».
- **Page** : titre et informations à gauche, actions à droite ; puis une fiche blanche (onglets, barre d'outils
  grise, table ou formulaire).
- **Barre d'état** en bas (masquée sur téléphone).

## Caisse (écran de travail tablette)

- **Une barre** : onglets Vente / Encaissement (compteur) / Caisse, et à droite l'état de la caisse.
  Au doigt, le titre de page disparaît : le rail dit déjà où l'on est.
- **Vente** : catalogue à gauche (recherche + catégories sur une ligne, tuiles 150 px ; sans aucune photo dans la
  liste, tuiles de texte), ticket à droite sur toute la hauteur (360 px, 320 en portrait). Tuile déjà dans le ticket
  = bordure bleue + quantité en case bleue. Table choisie dans une fenêtre de tables par zone. Pied fixe : total,
  ENVOYER LA COMMANDE, puis ENCAISSER (caisse ouverte), remarque et vider en boutons-icônes.
- **Messages de la vente dans le ticket** : rien n'apparaît au-dessus des produits sous le doigt.
- **Encaissement** : liste des notes ; la première est affichée d'office avec ENCAISSER en bas.
- **Paiement au pavé numérique** : 4 modes, parts 1/2 1/3 1/4, cases « Montant encaissé » et « Reçu du client »,
  billets jusqu'à 50 000, monnaie à rendre ; clavier physique au PC.

## Commandes et cuisine

- **Commandes** : quatre colonnes pleine hauteur (À traiter, En cuisine, Prêtes à servir, Servies · à encaisser),
  appels des tables dans « À traiter » (compteur rouge) ; en portrait, une colonne par onglet.
- **Lieu d'une commande** partout identique (`orderPlace`) : « Table T3 », « À emporter · nom », « Comptoir ».
- **Messages** des écrans de service : toast en bas (`FloatMessage`).
- **Cuisine** : sombre ; postes en boutons, colonnes pleine hauteur, minuteur « m:ss » puis « 1 h 05 ».

## Tables

- **Service** / **Aménager** ; en service, plan recadré sur les tables et agrandi, fiche de la table à droite
  (boutons en bas) ; sans table choisie, Libres / Occupées / À traiter.
- Pages de travail (caisse, commandes, cuisine, tables) : `flex: 1 1 0`, jamais agrandies par leur contenu ; chaque
  liste défile dans sa fiche.

## Écrire

Libellés courts qui disent l'action : « Nouvelle commande », « Encaisser », « Fermer la caisse » (affichés en
capitales sur les boutons par le style, jamais écrits en capitales dans le code). Pas de texte d'orientation ni de
phrase de vitrine. Un message d'erreur dit ce qui ne va pas et comment corriger.

## Compatibilité

WebView Chrome 83 (tablettes) : pas de `gap` sur flexbox, pas de `inset`, pas de `:is()` ni `:has()`.
Arabe : propriétés logiques (`margin-inline-start`…), Roboto ne couvre pas l'arabe (repli Noto Sans Arabic / Tahoma).
