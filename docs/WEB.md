# AfriKaisse — Web

`apps/web` : React 19 + Vite 7. En phase 1 il contient la connexion, l'inscription, le choix
d'organisation, l'organisation, l'équipe, le journal d'audit, le compte et le back-office.

## Trois publics, trois exigences

| Public | Où | Exigence |
|---|---|---|
| Client (menu QR) | `app.afrikaisse.com/m/<jeton>` — phases 3-4 | **Très léger** (bundle séparé, sans Zod complet), PWA, images compressées, 3G moyenne |
| Personnel et gérant | Web Cloud, POS local, application Capacitor | Rapide, gros boutons, fonctionne sur de vieilles WebView |
| AfriKaisse (back-office) | Web Cloud | Densité d'information |

## Règles

- **Session** : jeton d'accès en mémoire, renouvellement par cookie httpOnly. **Réseau coupé ≠
  session expirée** : on n'efface la session que sur un 401 du renouvellement ; sinon écran
  « Serveur injoignable » avec « Réessayer » (leçon WIFIHUB).
- **Droits** : l'interface lit `me.permissions` pour masquer ce qui est interdit. Le serveur
  revérifie tout.
- **Aucun bouton factice** (§81) : un écran n'apparaît que lorsque sa fonction existe.
- **i18n** : `src/i18n.tsx`. Français de référence ; anglais et arabe branchés. `dir="rtl"` pour
  l'arabe. CSS en propriétés **logiques** (`margin-inline-start`…), écrites en longhand pour Chrome 83.
- **Thèmes** : clair, sombre, système (`data-theme`). Jetons de couleur dans `styles.css`.
- **Compatibilité** : build `es2019`, CSS `chrome80`. Pas de `gap` sur flexbox (absent de Chrome 83 :
  on utilise la grille), pas de `:where`, pas de `dvh`.

## Tablette d'abord (ADR-011)

L'appareil de référence du personnel est la **tablette Android 10"** (1280×800 paysage, 800×1280
portrait), utilisée au doigt. Le PC vient ensuite.

| Règle | Mise en œuvre (`styles.css`, section « Tablette d'abord ») |
|---|---|
| Cibles tactiles ≥ 44 px | `@media (pointer: coarse)` : boutons et champs de 44 px, onglets de 52 px, lignes de table de 52 px |
| Pas de zoom au focus | Champs en 16 px sur écran tactile |
| Aucun geste caché | Sélection d'une ligne au toucher, puis bouton de la barre d'outils. Le double-clic n'est qu'un raccourci souris. Pas de survol ni de clic droit obligatoire. |
| Réactivité | `touch-action: manipulation` (pas de délai de 300 ms), pas de surlignage gris au toucher, texte non sélectionnable dans les barres et les tables |
| Portrait | Sous 900 px : établissement masqué dans la barre d'application, nom d'utilisateur tronqué, marges réduites |
| Vérification | Chaque écran est contrôlé en 1280×800 **et** 800×1280 avant livraison |

## Identité visuelle — style « logiciel de gestion »

Direction validée par GLOBALTECH (13/09/2026) : **l'esprit WebDev/WinDev, modernisé et soigné**,
sans aucun des tics des interfaces générées (panneau slogan, cartes partout, dégradés, pastilles
arrondies, emoji).

| Élément | Règle |
|---|---|
| Coque | Barre d'application bleue (`#1D4D82`) : organisation, établissement, utilisateur · barre de menus à onglets · zone de travail grise · **barre d'état** avec des informations réelles (connexion, Cloud/local, moteur, organisation, version) |
| Écran | Une **fenêtre** : bandeau titre + compteur, **barre d'outils** (icônes au trait 16 px + libellé), contenu |
| Listes | **Tables à sélection de ligne** ; les boutons de la barre d'outils agissent sur la ligne choisie et se grisent sinon ; double-clic = Modifier ; en-têtes collants, lignes alternées |
| Saisie | **Fenêtres modales** à bandeau bleu, libellés à gauche, groupes `fieldset/legend`, boutons en bas à droite, Échap ferme |
| Typo | Segoe UI 13 px, chiffres tabulaires |
| Formes | Rayons 2-3 px, bordures fines, pas d'ombre sauf sous les fenêtres modales |
| Messages | Bandeaux bordés « Erreur : … », jamais de toast qui disparaît avant d'être lu |
| Sombre | Même structure, gris neutres (exigé pour le KDS, §65) |
| Logo | Ticket de caisse à bord dentelé, bleu sur blanc |

## Menu client (`/m/<jeton>`)

Point d'entrée séparé (`menu.html`, `src/menu/`), sans Zod : il n'importe du cœur que des types et
les sous-modules sans dépendance `@afrikaisse/core/money`, `/pricing` et `/guests`.

| Fichier | Rôle |
|---|---|
| `src/menu/MenuApp.tsx` | Carte, recherche, Populaires, Favoris, fiche produit, panier, commande |
| `src/menu/ClientSheets.tsx` | Ma table (clients, commandes de la table, code, surnom), Payer (moyen de paiement), bandeau hors ligne, langue |
| `src/menu/i18n.tsx` | Dictionnaire du menu : français, anglais, arabe (`dir="rtl"`, chiffres latins pour les montants) ; langue du navigateur, puis choix gardé sur le téléphone |
| `src/menu/pwa.ts` | Manifeste, enregistrement du service worker, favoris / surnom / code de table en `localStorage` |
| `src/menu/menu-extra.css` | Styles des ajouts ; `menu.css` reste la base (refonte visuelle en parallèle) |
| `public/m/sw.js` | Service worker, portée `/m/` |
| `public/m/icon-*.png` | Icônes, produites par `node apps/web/scripts/menu-icons.mjs` (PNG en JavaScript pur) |

**PWA (§49)**. Manifeste servi par l'API (`/api/public/menu/<jeton>/manifest.webmanifest`, nom de
l'établissement). Le service worker n'est enregistré qu'en production et en contexte sécurisé
(HTTPS du Cloud, I-14) :

| Ressource | Stratégie | Borne |
|---|---|---|
| Page `/m/<jeton>` (même HTML pour toutes les tables) | Réseau d'abord, copie de secours | 1 |
| `/assets/*` (noms à empreinte), icônes | Cache d'abord | 40 entrées |
| Photos `/api/media/*` | Cache d'abord, chargées paresseusement (`loading="lazy"`) | 80 entrées |
| Carte `/api/public/menu/<jeton>` | Copie immédiate + mise à jour en arrière-plan ; la page recharge la carte si elle a changé | 5 cartes |
| Commandes, « Ma table », appels | Réseau seulement | — |

Réponses de plus de 1 Mo jamais mises en cache. Ce que la page a chargé avant l'installation du
service worker lui est signalé (`afk-menu-warm`) pour être disponible hors ligne dès la première visite.

**Hors ligne (I-1)**. Le menu reste consultable ; panier, appel et addition sont coupés avec « Commande
indisponible hors connexion, appelez un serveur ». « Ma table » est relue toutes les 8 s tant qu'une
commande de ce téléphone est en cours ou qu'une addition est demandée, toutes les 30 s pour détecter
le retour de la connexion, jamais quand la page est masquée. `orderingAvailable: false` (serveur local
muet) affiche « Commande en ligne momentanément indisponible ».

Côté personnel : `src/pages/TableGuests.tsx` (code de table, parts par client, détail des appels),
styles dans `src/styles/client.css`.

## Site public (`apps/site`)

Cahier des charges §3.1 : présentation, fonctionnalités, tarifs, démonstration, FAQ, contact, et accès à
la connexion et à l'inscription de l'application. Pages statiques, **aucun JavaScript envoyé au
navigateur** (menu téléphone et FAQ en `<details>`).

| Élément | Règle |
|---|---|
| Pages | `/`, `/fonctionnalites/`, `/tarifs/`, `/demonstration/`, `/faq/`, `/contact/`, `404.html` |
| Construction | `npm run build:site` → `apps/site/dist`. `src/pages.ts` écrit le HTML, puis Vite assemble `src/site.css`, Roboto (@fontsource) et `public/` |
| Adresses | `SITE_APP_URL` (défaut `DEFAULT_CLOUD_URL` de core : https://afrikaisse.dametta.com) pour **Connexion** et **Créer mon restaurant** (`<app>/#inscription` ouvre le formulaire d'inscription de `apps/web`) ; `SITE_URL` (défaut https://www.afrikaisse.dametta.com) pour les liens canoniques, Open Graph et `sitemap.xml` |
| Coordonnées | `apps/site/src/config.ts`, seul fichier à modifier. Téléphone et WhatsApp à `null` = ligne masquée (aucun numéro inventé). **L'adresse `contact@afrikaisse.com` est à confirmer** par GLOBALTECH avant la mise en ligne |
| Textes | `src/i18n/fr.ts`, typé par `SiteText` (`src/i18n/types.ts`). Anglais et arabe : un fichier par langue + une entrée dans `LOCALES` (préfixe `/en`, `dir: 'rtl'` pour l'arabe) ; la CSS est en propriétés logiques |
| Faits | Prix, limites, durée d'essai et de grâce lus dans `packages/core/src/plans.ts` ; devises dans `currency.ts` ; nombre de plats et de photos dans le catalogue de `apps/web/public/catalogue`. Rien n'est recopié à la main |
| Design | Identité WEBDEV 28 de `DESIGN.md` : bandeau bleu `#065FD4` (rubrique active en aplat plus foncé souligné de blanc), Roboto, boutons plats en capitales avec pictogramme à gauche, rayon 4 px, fiches à bande de titre grise, tables zébrées à en-tête gris, barre d'état en pied de page. Pas de dégradé, d'animation ni de grille de cartes décoratives |
| Images | Captures **réelles** de l'application (restaurant de démonstration, 15/09/2026) dans `public/captures` ; six photos du catalogue (CC0 / domaine public), jamais d'auteur affiché. Aucun témoignage, logo client ni chiffre inventé (§81) |
| SEO | Titre et description par page, lien canonique, Open Graph (`og-afrikaisse.png`), JSON-LD (SoftwareApplication, FAQPage), `sitemap.xml`, `robots.txt`, 404 en `noindex` |
| Largeurs | 360 px à 1440 px ; menu complet dans le bandeau à partir de 1180 px, menu déroulant en dessous |
| Contrôle | `apps/site/test/site.test.ts` (dans `npm test`) : pages, titres, un seul `h1`, liens et ancres internes, prix identiques à `plans.ts`, textes alternatifs, pas d'emoji ni d'auteur de photo, sitemap, budget JS + CSS < 150 Ko gzip, coordonnées masquées à `null` |

Mesure du 15/09/2026 : 0 Ko de JavaScript, CSS 16,8 Ko (3,8 Ko gzip), HTML des 7 pages 33 Ko gzip.
Déploiement : DEPLOYMENT.md §7.

## Mesures

Build phase 1 : 350 Ko de JS (106 Ko gzip), 7 Ko de CSS. Le poids vient surtout de Zod, importé via
les contrats partagés. Acceptable pour le personnel.

Menu client (15/09/2026) : 38,8 Ko de JS propre (13,7 Ko gzip) + 4,7 Ko de calcul des prix, React
partagé avec le logiciel (69 Ko gzip, mis en cache une fois), 14 Ko de CSS (3,5 Ko gzip). Aucun Zod.
