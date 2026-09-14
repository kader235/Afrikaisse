# AfriKaisse — système visuel

AfriKaisse est un outil de travail utilisé tous les jours dans un restaurant. L'interface suit la rigueur d'un
logiciel de gestion (zones séparées, boutons identifiables, tableaux lisibles, formulaires à libellés) avec la
finition d'un logiciel actuel. Chaque élément doit aider le restaurateur à travailler plus vite ; sinon il disparaît.

Tout le style vit dans une seule feuille : `apps/web/src/styles.css` (le menu client a la sienne : `src/menu/menu.css`).

## Couleurs

| Rôle | Clair | Sombre | Usage |
| --- | --- | --- | --- |
| Fond | `#EEF1F4` | `#14191F` | derrière les pages |
| Surface | `#FFFFFF` | `#1B2129` | cadres, tableaux, fenêtres |
| Bande | `#F5F7F9` | `#212832` | en-têtes de tableau, titres de groupe, pieds de fenêtre |
| Bordure | `#D3D9E0` | `#313A46` | contours ; filets internes `#E3E7EC` / `#29313B` |
| Texte | `#1A232E` | `#E3E8EE` | secondaire `#465261`, discret `#6B7683` |
| Bleu AfriKaisse | `#1D5AA8` | `#5B95DA` | action principale, sélection, lien |
| Ocre | `#C58A1C` | `#D9A441` | repère d'identité : rubrique active, nom du produit |
| Barre supérieure | `#17375D` | `#0F2138` | liseré bleu, or, rouge de 3 px en dessous |
| Succès / attention / erreur | `#2B7A4B` / `#9A6300` / `#B3392E` | `#5DBB85` / `#DDB05A` / `#E57F74` | états seulement, jamais en décoration |

Le thème sombre est une variante à part entière (surfaces graphite, bleu éclairci), pas une inversion.
L'écran cuisine reste sombre dans les deux thèmes : il est lu à distance, sous un éclairage fort.

## Typographie

Police du système (Segoe UI sous Windows, Roboto sous Android) : rien à télécharger, fonctionne hors ligne.

| Niveau | Taille | Graisse |
| --- | --- | --- |
| Titre de page | 20 px | 600 |
| Titre de groupe, de fenêtre | 13–14 px | 600, sur bande |
| Rubrique de navigation, libellé d'indicateur | 11 px | 600, capitales espacées |
| Libellé de champ | 13 px | 400, couleur secondaire |
| Valeur | 13 px | 400 ; montants en chiffres tabulaires |
| Aide | 12 px | 400, couleur discrète |

Au doigt (tablette), la base passe à 14 px et les champs à 16 px (sinon Android zoome au focus).

## Formes et densité

- Coins : 4 px (boutons, champs, tuiles), 6 px (cadres, fenêtres). Jamais de pilule.
- Ombres : uniquement sur les fenêtres modales et le panneau latéral. Ailleurs, des bordures fines.
- Hauteurs : 32 px à la souris, 40 px au doigt ; lignes de tableau 38 px, 46 px au doigt.
- Espacements sur une grille de 4 : 4, 8, 12, 16, 24. Pages en 16 px de marge.
- Aucune animation permanente ; aucun dégradé décoratif ; icônes d'une seule famille (trait 16 px).

## Structure

- **Barre supérieure** (52 px) : logo, établissement actif, commandes à traiter, état de la liaison, utilisateur.
- **Navigation latérale** groupée : Tableau de bord ; Vente (Caisse, Commandes, Tables) ; Restaurant (Cuisine,
  Menu) ; Gestion (Stock, Établissements) ; Administration (Personnel, Paramètres, Journal). Icône + texte.
  Tablette : rail étroit, icône au-dessus du texte. Téléphone : barre du bas (4 accès du métier + Menu).
- **Page** : en-tête (titre et informations à gauche, actions à droite), puis un cadre. Barre d'outils en haut du
  cadre, sous-onglets si besoin, contenu.
- **Groupe** (`fieldset.group`) : cadre à bandeau de titre. Sert aux formulaires, fiches et encadrés.
- **Fenêtre modale** : titre, contenu, pied avec [Action] [Annuler]. Rien d'autre.

## Écrire

Des libellés courts qui disent ce qui se passe : « Nouvelle commande », « Encaisser », « Fermer la caisse ».
Pas de phrases de vitrine. Un message d'erreur dit ce qui ne va pas et comment corriger.

## Compatibilité

WebView Chrome 83 (tablettes) : pas de `gap` sur flexbox (marges à la place), pas de `inset`, pas de `:is()`.
Arabe : propriétés logiques (`margin-inline-start`…) pour le sens de lecture.
