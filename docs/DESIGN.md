# AfriKaisse — design system

AfriKaisse est un logiciel métier moderne pour restaurants : la rigueur d'un logiciel de gestion (zones séparées,
actions visibles, tableaux lisibles, formulaires à libellés) avec la finition d'un POS actuel. Règle de conception :
on doit pouvoir travailler 8 heures devant l'écran sans fatigue, et comprendre en trois secondes où l'on est, ce qui se
passe, ce qui demande une action et quelle action faire. Un élément qui n'aide pas à travailler disparaît.

Tout le style vit dans `apps/web/src/styles.css` (le menu client a le sien : `src/menu/menu.css`).

## Analyse de départ (septembre 2026)

| Constat | Cause | Réponse du système |
| --- | --- | --- |
| Texte trop petit | base 14 px, titres de page 22 px, titres de cadre 13 px | base 15 px, échelle 24 / 16 / 15 / 13 |
| Trop de gris | fond, bandeaux de titre, en-têtes de tableau et navigation tous gris | surfaces blanches, gris réservé au fond et aux en-têtes de tableau |
| Hiérarchie plate | 7 cadres de même poids sur le tableau de bord | 3 niveaux : l'essentiel, l'activité, l'état du service |
| Boutons, icônes discrets | boutons 36 px, icônes 16 px | boutons 40 px (48 au doigt), icônes 18-20 px |
| Navigation dense | lignes 40 px, 14 px, indicateur fin | lignes 44 px, 15 px, languette safran |
| Tableau de bord administratif | un rapport de période présenté comme un accueil | « aujourd'hui » raconté ; l'analyse part dans Rapports |
| Manque de personnalité | bleu générique, rien de propre | signature bleu nuit + safran, initiales, languette |

## Signature AfriKaisse

Trois éléments rendent l'écran reconnaissable sans logo :

1. **La barre bleu nuit** (`#0F2A4A`) avec le liseré bleu, or et rouge de 3 px.
2. **Le safran** (`#D98F0C`) : languette de la rubrique active au bord de la navigation, initiales de l'utilisateur,
   « Kaisse » dans le nom. Jamais en aplat décoratif.
3. **Le bleu AfriKaisse** (`#1D58A8`) : uniquement ce qui se clique ou ce qui est sélectionné.

## Couleurs

| Jeton | Clair | Sombre | Usage |
| --- | --- | --- | --- |
| `--bg` | `#F2F4F7` | `#10151C` | fond des pages (clair, pas blanc) |
| `--surface` | `#FFFFFF` | `#171E27` | panneaux, tableaux, fenêtres, navigation |
| `--band` | `#F7F8FA` | `#1C242F` | en-têtes de tableau, zones de saisie en lecture |
| `--border` / `--line` | `#DCE1E7` / `#E9EDF1` | `#2B3542` / `#232C37` | contours / filets internes |
| `--text` | `#111A27` | `#EEF2F6` | texte principal, chiffres |
| `--text-soft` | `#3B4758` | `#C3CCD6` | libellés, texte secondaire |
| `--muted` | `#647184` | `#8D99A8` | informations tertiaires seulement |
| `--primary` | `#1D58A8` | `#6FA5EC` | action principale, sélection, focus |
| `--ochre` (safran) | `#D98F0C` | `#EDB13B` | signature |
| `--topbar` | `#0F2A4A` | `#0B1627` | barre supérieure |
| `--attention` | `#D23F31` | `#E35D50` | compteur de ce qui attend une action |
| Succès / attention / erreur | `#1F7D4D` / `#A86500` / `#C0392F` | `#5DBB85` / `#DDB05A` / `#E57F74` | messages uniquement |

Thème sombre dessiné à part : surfaces graphite bleuté, texte blanc cassé, bleu éclairci pour garder le contraste,
safran plus lumineux. L'écran cuisine reste sombre dans les deux thèmes.

Couleurs d'état (pastille à côté d'un texte neutre, jamais le texte lui-même) : libre vert `#2F9E5E`, en cours bleu,
en attente or `#E0A526`, bloqué / annulé rouge `#C0392B`.

## Typographie

Police du système (Segoe UI, Roboto sous Android) : rien à télécharger, fonctionne hors ligne.

| Rôle | Taille | Graisse |
| --- | --- | --- |
| Chiffre clé | 30 px (24 sur téléphone) | 600, chiffres tabulaires |
| Titre de page | 24 px | 600 |
| Titre de panneau | 16 px | 600 |
| Texte courant, navigation, boutons | 15 px | 400 / 500 / 600 |
| Cellule de tableau | 14,5 px | 400 |
| Libellé d'en-tête de tableau, texte secondaire | 13 px | 600 / 400 |
| Titre de groupe de navigation | 12 px | 600, capitales espacées |

Au doigt, la base passe à 16 px.

## Tailles et espacements

- Grille de 4 px : 4, 8, 12, 16, 20, 24. Marge de page 28 px (16 sur téléphone), écart entre panneaux 20 px.
- Hauteurs : bouton et champ 40 px (48 au doigt) ; ligne de navigation 44 px ; ligne de tableau 52 px ; ligne d'action
  « état du service » 60 px.
- Coins : 6 px (boutons, champs, lignes de navigation), 8 px (panneaux, fenêtres). Pas de pilule.
- Ombres : fenêtres modales et panneau latéral seulement.

## Composants

- **Bouton principal** : aplat bleu, texte blanc 600, icône 18 px. Un seul par zone.
- **Bouton secondaire** : fond blanc, bordure `--border-strong`, texte 500.
- **Lien d'action de ligne** (`.row-link`) : texte secondaire 600 + chevron, bleu au survol.
- **Champ** : 40 px, libellé toujours visible au-dessus ou à gauche ; focus = bordure bleue + halo 3 px ; erreur =
  bordure rouge ; lecture seule = fond `--band`.
- **Panneau** (`.panel`) : fond blanc, bordure, coin 8 px ; en-tête 56 px (titre 16 px, compteur, lien d'action) ;
  corps 20 px, ou tableau collé aux bords.
- **Groupe** (`fieldset.group`) : même allure qu'un panneau, pour les formulaires et fiches.
- **Tableau** (`table.grid`) : en-tête 44 px gris très clair, lignes 52 px séparées d'un filet, survol, ligne choisie
  en bleu pâle avec repère bleu à gauche ; montants alignés à droite (`.end`).
- **Compteur** (`.now-count`) : case 40 × 36 ; neutre à zéro, rouge `--attention` quand une action attend.
- **Statut** (`.st`) : pastille de couleur + texte neutre.
- **Message** (`.msg`) : fond blanc, filet, icône ; danger en rouge avec triangle, réussite en vert avec coche.
- **Fenêtre modale** : titre 17 px, contenu, pied [Action] [Annuler] ; aucune illustration.
- **Icônes** : une seule famille, trait arrondi, grille 16, rendues à 18 px (boutons) ou 20 px (navigation).

## Structure

- **Barre supérieure** (56 px) : logo, établissement et organisation, liaison, cloche des commandes à traiter,
  utilisateur (initiales safran).
- **Navigation** (248 px) : Tableau de bord ; Vente (Caisse, Commandes, Tables) ; Restauration (Cuisine, Menu) ;
  Gestion (Stock) ; Administration (Personnel, Rapports, Établissements, Paramètres, Journal). Achats, fournisseurs
  et clients ne sont pas encore développés : ils n'apparaissent pas.
- Tablette paysage étroite (≤ 1200 px) : rail de 96 px, icône au-dessus du nom. Téléphone : barre du bas + « Plus ».
- **Page** : titre et contexte à gauche, action principale à droite ; puis les panneaux.

## Tableau de bord (écran de référence)

1. **L'essentiel d'aujourd'hui** : chiffre d'affaires, commandes, panier moyen, tables occupées, chacun comparé à hier.
2. **Activité du jour** heure par heure, avec hier en fond pour situer le service.
3. **État du service** : commandes à confirmer, demandes des tables, prêtes à servir, en préparation, stock faible ;
   chaque ligne ouvre l'écran concerné.
4. **Commandes en cours** et **meilleures ventes**.

## Écrire

Libellés courts qui disent ce qui se passe : « Nouvelle commande », « Encaisser », « Fermer la caisse ». Pas de texte
d'orientation ni de phrase de vitrine. Un message d'erreur dit ce qui ne va pas et comment corriger.

## Compatibilité

WebView Chrome 83 (tablettes) : pas de `gap` sur flexbox (marges), pas de `inset`, pas de `:is()`.
Arabe : propriétés logiques (`margin-inline-start`…).
