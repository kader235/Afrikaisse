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
les contrats partagés. Acceptable pour le personnel. **Le menu client aura son propre point
d'entrée**, qui n'importera que les types.
