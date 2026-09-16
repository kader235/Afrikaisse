import { RESOURCE_LABELS } from '@afrikaisse/core';
import type { SiteText } from './types.ts';

/**
 * Texte du site en français. Règles : des faits vérifiables dans l'application (docs/USER_GUIDE.md),
 * aucune phrase de vitrine, aucun chiffre inventé, aucun témoignage. Les prix, limites, devises et
 * nombres de plats viennent du code (`f`), jamais recopiés ici.
 */
export const fr: SiteText = {
  skip: 'Aller au contenu',
  ogImageAlt: "Écran Caisse de l'application AfriKaisse",
  nav: {
    home: 'Accueil',
    features: 'Fonctionnalités',
    pricing: 'Tarifs',
    demo: 'Démonstration',
    faq: 'FAQ',
    contact: 'Contact',
    menu: 'Menu',
    main: 'Navigation principale',
    mobile: 'Navigation',
    brandHome: 'AfriKaisse, accueil',
  },
  actions: {
    login: 'Connexion',
    register: 'Créer mon restaurant',
    pricing: 'Voir les tarifs',
    features: 'Toutes les fonctionnalités',
    compare: 'Comparer les offres',
    quote: 'Demander un devis',
    contact: 'Nous écrire',
    demo: 'Essayer AfriKaisse',
    faq: 'Questions fréquentes',
  },
  captures: {
    caption: "capture de l'application, restaurant de démonstration",
    items: {
      caisse: { title: 'Caisse', alt: "Écran Caisse d'AfriKaisse sur PC : rubriques dans le rail bleu nuit, catégories, tuiles des plats avec photo et prix, ticket de la vente à droite avec Sur place ou À emporter et le bouton Envoyer la commande" },
      'tableau-de-bord': { title: 'Tableau de bord', alt: "Tableau de bord d'AfriKaisse : chiffre d'affaires du jour, commandes, tables occupées, temps de cuisine, ventes par heure, service en cours, commandes en direct et plats les plus vendus" },
      tables: { title: 'Plan de salle', alt: "Plan de salle d'AfriKaisse en service : six tables de la zone Salle, libres, occupées avec leur durée, commande prête ou réglée, et le décompte libres, occupées, à traiter" },
      menu: { title: 'Menu', alt: "Écran Menu d'AfriKaisse : catégories à gauche, plats de la catégorie avec photo, prix, versions, options et disponibilité, onglets Options, Postes, Imprimantes, QR codes, Taxes et promotions, Annonces, Thème du menu" },
      commande: { title: 'Prise de commande sur tablette', alt: "Prise de commande d'AfriKaisse sur tablette : tables de la salle et de la terrasse, annonce à la une, catégories et plats avec photo, commande de la table T4 à droite avec ses quatre lignes, le total et le bouton Envoyer en cuisine" },
      'menu-client': { title: 'Menu QR du client', alt: "Menu QR d'AfriKaisse sur le téléphone du client : nom du restaurant et table, recherche, annonce à la une, catégories avec photo, plats les plus commandés et la barre Menu, Chercher, panier, Ma table, Serveur" },
    },
  },
  footer: {
    tagline: (f) => `Logiciel de gestion de restaurant édité par ${f.company}, ${f.city}.`,
    product: 'Le site',
    access: 'Accès',
    language: 'Français',
    prices: 'Tarifs en FCFA',
  },

  home: {
    title: 'AfriKaisse — logiciel de caisse et de gestion pour restaurants en Afrique',
    description: (f) =>
      `Caisse, menu QR sans application, écran cuisine, stock et plan de salle. Fonctionne sans Internet sur le PC du restaurant, avec tablettes Android. Prix en FCFA, essai gratuit de ${f.trialDays} jours.`,
    h1: "Caisse, commandes QR, cuisine et stock pour les restaurants d'Afrique",
    lead: 'AfriKaisse fonctionne en ligne ou sur le PC du restaurant, même quand Internet est coupé. Tablettes Android pour la salle et la cuisine, menu QR sans application pour les clients, montants en FCFA.',
    trial: (f) => `Essai gratuit de ${f.trialDays} jours avec toutes les fonctions. Aucun moyen de paiement demandé à l'inscription.`,
    factsTitle: 'AfriKaisse en bref',
    facts: (f) => [
      { id: 'hors-ligne', label: 'Sans Internet', text: "Installé sur le PC du restaurant, AfriKaisse continue d'encaisser, d'envoyer en cuisine et d'imprimer quand la connexion tombe." },
      { id: 'tablette', label: 'Tablettes Android', text: 'Une application pour la caisse, les serveurs et la cuisine, utilisable au doigt en paysage et en portrait.' },
      { id: 'menu-qr', label: 'Menu QR', text: "Le client scanne le QR de sa table : la carte s'ouvre dans son navigateur, sans application ni compte." },
      { id: 'paiements', label: 'Paiements', text: "Espèces, Mobile Money, carte ou autre. En Mobile Money, le caissier note l'opérateur et le numéro de transaction." },
      { id: 'impression', label: 'Impression', text: 'Tickets de préparation par poste et reçus sur imprimantes thermiques réseau de 80 ou 58 mm.' },
      { id: 'etablissements', label: 'Plusieurs établissements', text: 'Une organisation, plusieurs établissements, chacun avec ses tables, sa caisse et son équipe.' },
      { id: 'devises', label: 'Devises', text: `${f.currencies}.` },
      { id: 'langues', label: 'Langues', text: 'Écrans du personnel en français, en anglais et en arabe.' },
    ],
    modulesTitle: 'Tout le service, de la commande à la clôture de caisse',
    modules: [
      { id: 'caisse', title: 'Caisse', text: 'Vente au doigt, sur place ou à emporter, addition partagée, rapports X et Z.' },
      { id: 'commandes', title: 'Commandes', text: 'Commandes QR et commandes des serveurs en colonnes, de la confirmation au paiement.' },
      { id: 'menu-qr', title: 'Menu QR', text: "Un QR par table : le client commande, appelle un serveur ou demande l'addition." },
      { id: 'cuisine', title: 'Écran cuisine et bar', text: 'Tickets par poste avec minuteur et signal sonore, passés « prêt » d’un geste.' },
      { id: 'tables', title: 'Plan de salle', text: 'Tables libres, occupées, prêtes ou à confirmer, mises à jour sans recharger.' },
      { id: 'stock', title: 'Stock et recettes', text: 'Chaque commande déduit sa recette ; un plat passe épuisé quand un ingrédient manque.' },
      { id: 'impression', title: 'Impression', text: 'Tickets de préparation et reçus sur imprimantes thermiques réseau.' },
      { id: 'pilotage', title: 'Tableau de bord', text: 'Ventes du jour comparées à la veille, heures de pointe, modes de paiement, export CSV.' },
    ],
    flowTitle: "Le trajet d'une commande",
    flow: [
      { title: 'Commande', text: 'Le client commande par le QR de sa table, ou le serveur saisit la commande sur sa tablette.' },
      { title: 'Confirmation', text: 'La salle confirme les commandes QR. La recette de chaque plat est déduite du stock.' },
      { title: 'Préparation', text: 'Chaque plat part à son poste : écran cuisine ou bar, et ticket imprimé.' },
      { title: 'Service', text: 'La commande prête apparaît sur l’écran Commandes et sur le plan de salle.' },
      { title: 'Encaissement', text: 'Espèces, Mobile Money ou carte. Une table entièrement réglée se libère seule.' },
      { title: 'Suivi', text: 'Ventes, paiements par mode et meilleures ventes arrivent au tableau de bord.' },
    ],
    modesTitle: 'En ligne ou sur le PC du restaurant',
    modesLead: 'Chaque établissement choisit son mode de fonctionnement.',
    modesCriterion: 'Point comparé',
    modesCloud: 'AfriKaisse Cloud',
    modesLocal: 'Serveur local',
    modes: (f) => [
      ['Où tourne AfriKaisse', `Sur Internet, à l'adresse ${f.appHost}`, 'Sur un PC Windows 10 ou 11 du restaurant'],
      ['Connexion Internet', 'Indispensable', 'Facultative : caisse, commandes, cuisine et impression continuent sans elle'],
      ['Matériel sur place', 'Tablettes Android ou ordinateurs', 'Le PC, le Wi-Fi du restaurant et les tablettes'],
      ['Commande QR par les clients', 'Oui, avec les données mobiles du client', "Quand le PC est relié au Cloud et qu'Internet fonctionne"],
      ['Tickets', 'Reçus et additions en 80 mm depuis le navigateur', 'Tickets de préparation automatiques par poste, et reçus'],
      ['Suivi à distance', 'Oui', 'Une fois le PC relié au Cloud : synchronisation toutes les 5 secondes'],
    ],
    catalogueTitle: 'Une carte prête en quelques minutes',
    catalogueText: (f) =>
      `${f.catalogueDishes} plats courants à importer, dont ${f.cataloguePhotos} avec photo : ${f.catalogueGroups}. Le prix indicatif est converti dans votre devise ; vous le corrigez ensuite.`,
    catalogueNote: 'Photos du catalogue libres de droits (domaine public ou CC0).',
    dishAlt: (name) => `Photo du plat : ${name}`,
    pricingLead: 'Tarifs en vigueur, par mois. Toutes les fonctions dans chaque offre.',
    ctaTitle: 'Essayez AfriKaisse dans votre restaurant',
    ctaText: (f) => `${f.trialDays} jours gratuits avec toutes les fonctions. Vos données restent en place quand vous passez à une offre payante.`,
  },

  features: {
    title: "Fonctionnalités d'AfriKaisse : caisse, menu QR, cuisine, stock, hors ligne",
    description:
      'Caisse tactile, commandes QR, écran cuisine, plan de salle, stock et recettes, impression thermique, tableau de bord, serveur local sans Internet, tablette Android, plusieurs établissements.',
    h1: 'Fonctionnalités',
    lead: "Fonctions disponibles dans la version actuelle d'AfriKaisse.",
    toc: 'Sur cette page',
    sections: (f) => [
      {
        id: 'caisse',
        title: 'Caisse et encaissement',
        capture: 'caisse',
        points: [
          'Vente au doigt : catégories, produits, ticket toujours visible. Versions (33 cl, 1 litre) et options (cuisson, sauces) avec leur supplément.',
          'Sur place à une table, au comptoir, ou à emporter avec le nom du client.',
          'Espèces, Mobile Money, carte ou autre. Addition partagée en 1/2, 1/3 ou 1/4, monnaie à rendre calculée.',
          'Remises et plats offerts réservés aux responsables, avec un motif inscrit au journal.',
          'Fond de caisse, entrées et sorties d’espèces avec motif, rapport X, clôture avec écart et rapport Z.',
          'Reçu et addition imprimables en 80 mm.',
        ],
      },
      {
        id: 'commandes',
        title: 'Commandes',
        points: [
          'Quatre colonnes : à traiter, en cuisine, prêtes à servir, servies et à encaisser.',
          'Les commandes QR arrivent en quelques secondes avec un signal sonore, et le personnel les confirme avant la cuisine.',
          'Appels de serveur et demandes d’addition des tables dans la colonne « À traiter ».',
          'Numéros de commande par journée d’exploitation : une vente à 2 h du matin compte pour la veille.',
          'Annulation d’une commande partie en cuisine réservée aux responsables, avec motif.',
        ],
      },
      {
        id: 'tables',
        title: 'Plan de salle',
        capture: 'tables',
        points: [
          'Zones (salle, terrasse, VIP) et tables placées au doigt sur une grille, rondes ou rectangulaires.',
          'En service, le plan se met à jour seul : table libre, occupée avec sa durée, commande prête, appel ou commande QR à confirmer, table réglée.',
          'Fiche de la table : confirmer, servir, nouvelle commande, encaisser, imprimer l’addition, changer de table, libérer.',
          'Une table entièrement réglée se libère seule.',
        ],
      },
      {
        id: 'menu-qr',
        title: 'Menu QR pour les clients',
        capture: 'menu-client',
        points: [
          'Un QR par table, imprimé en chevalet ou sur une planche A4.',
          'Le client ouvre la carte avec l’appareil photo de son téléphone, sans application ni compte : recherche, photos, versions, options et allergènes.',
          'Il commande et suit sa commande : envoyée, confirmée, en cuisine, prête, servie. Il peut appeler un serveur ou demander l’addition.',
          'Le QR passe par les données mobiles du client : aucun Wi-Fi à partager.',
          'Régénérer un QR rend l’ancien inutilisable, par exemple si une photo du QR circule.',
        ],
      },
      {
        id: 'cuisine',
        title: 'Écran cuisine et bar',
        points: [
          'Postes Cuisine et Bar créés d’office ; d’autres à la demande (grill, pâtisserie). Chaque produit part au poste qui le prépare.',
          'Colonnes à préparer, en préparation, prêt. Minuteur depuis la confirmation, orange après 15 minutes, rouge après 25.',
          'Options et remarques du client mises en évidence, signal sonore à chaque nouveau ticket, plein écran pour une tablette murale.',
          'Quand tous les postes ont fini, la commande passe « prête » chez les serveurs.',
        ],
      },
      {
        id: 'carte',
        title: 'Menu et catalogue de plats',
        capture: 'menu',
        points: [
          'Catégories, produits, prix promotionnel, versions, groupes d’options, les 14 allergènes à déclaration obligatoire, étiquettes, photo réduite avant l’envoi.',
          '« Épuisé » en un geste depuis la caisse, la cuisine ou le bar : le client le voit aussitôt sur son menu.',
          `Import de plats : ${f.catalogueDishes} plats courants classés par région, avec photo libre de droits et prix indicatif converti dans la devise de l’établissement.`,
        ],
      },
      {
        id: 'stock',
        title: 'Stock et recettes',
        points: [
          'Articles avec unité, seuil d’alerte et coût. Réceptions, inventaires, pertes et sorties, toujours avec motif.',
          'Recettes par plat ou par version, avec le coût matière estimé et sa part du prix de vente.',
          'Chaque commande confirmée déduit sa recette ; une commande annulée la rend.',
          'Un plat passe épuisé tout seul quand un ingrédient ne suffit plus pour une portion, et revient à la réception suivante.',
        ],
      },
      {
        id: 'impression',
        title: 'Impression des tickets',
        points: [
          'Imprimantes thermiques réseau (Epson, Xprinter…) en 80 ou 58 mm, branchées sur la box du restaurant.',
          'Tickets de préparation automatiques pour chaque poste concerné, reçus de caisse, accents imprimés correctement.',
          'File d’impression : ce qui est sorti, ce qui a échoué, et relance d’un ticket.',
          'Les imprimantes réseau passent par le serveur local. Sans lui, le reçu et l’addition s’impriment en 80 mm depuis le navigateur.',
        ],
      },
      {
        id: 'pilotage',
        title: 'Tableau de bord et rapports',
        capture: 'tableau-de-bord',
        points: [
          'Chiffre d’affaires, commandes, panier moyen et tables occupées, comparés à la veille à la même heure.',
          'Activité heure par heure, état du service, commandes en cours, meilleures ventes.',
          'Rapports par période : ventes par jour, heures de pointe, modes de paiement, origine des commandes, produits les plus vendus. Export CSV pour Excel.',
        ],
      },
      {
        id: 'equipe',
        title: 'Équipe et contrôle',
        points: [
          'Rôles : propriétaire, administrateur, gérant, caissier, serveur, cuisine, bar, magasinier. Chacun ne voit que les écrans de son rôle.',
          'On ne donne qu’un rôle inférieur au sien. Désactiver un membre coupe son accès immédiatement, sur tous ses appareils.',
          'Journal non modifiable : connexions, ajouts et modifications de membres, changements de mot de passe.',
          'Connexion bloquée 15 minutes après 5 erreurs de mot de passe de suite.',
        ],
      },
      {
        id: 'hors-ligne',
        title: 'Fonctionnement sans Internet',
        points: [
          'Installateur pour Windows 10 et 11 (64 bits) : le serveur AfriKaisse démarre avec la session, les tablettes s’y connectent par le Wi-Fi du restaurant.',
          'Les données restent sur le PC. Une copie vérifiée de la base est faite au démarrage puis toutes les heures.',
          'Relié à AfriKaisse Cloud, le PC synchronise toutes les 5 secondes : ventes, caisse et stock remontent, les changements de carte et d’équipe descendent. Pendant une coupure, tout part au retour de la connexion.',
          'Un PC volé ou remplacé se révoque depuis le Cloud.',
          'Pendant une coupure, les clients commandent auprès d’un serveur : leur téléphone ne peut pas joindre le PC du restaurant.',
        ],
      },
      {
        id: 'tablette',
        title: 'Application tablette Android',
        points: [
          'Une application pour la caisse, les serveurs et la cuisine, prévue pour le doigt, en paysage comme en portrait.',
          'Connexion à AfriKaisse Cloud ou au serveur local du restaurant ; la session reste ouverte après un redémarrage.',
          'Hors du Wi-Fi du restaurant, la connexion est toujours chiffrée (HTTPS).',
        ],
      },
      {
        id: 'etablissements',
        title: 'Plusieurs établissements',
        points: [
          'Une organisation, plusieurs établissements : restaurant, hôtel, café, bar, lounge, fast-food, boulangerie, pâtisserie, food court.',
          'Chaque établissement a son mode de fonctionnement, son heure de début de journée, ses tables et sa caisse. Un membre est rattaché à un établissement ou à tous.',
          'Un établissement archivé garde son historique et peut être réactivé.',
        ],
      },
      {
        id: 'langues',
        title: 'Langues et devises',
        points: [
          'Écrans du personnel en français, en anglais et en arabe (de droite à gauche), thème clair ou sombre.',
          `Devises : ${f.currencies}. Le pays choisi propose la devise et le fuseau horaire.`,
          'Montants enregistrés en unités entières de la devise : aucune erreur d’arrondi dans les totaux.',
        ],
      },
    ],
  },

  pricing: {
    title: 'Tarifs AfriKaisse : essai gratuit, Essentiel, Pro et Groupe',
    description: (f) => `${f.plansSummary}. Toutes les fonctions dans chaque offre, règlement par Mobile Money ou virement.`,
    h1: 'Tarifs',
    lead: "Tarifs en vigueur, par mois, en francs CFA. Toutes les offres donnent accès à toutes les fonctions : elles se distinguent par le nombre d'établissements, de membres de l'équipe et de serveurs locaux.",
    offer: 'Offre',
    price: 'Prix',
    summary: 'Pour qui',
    free: 'Gratuit',
    perMonth: '/ mois',
    trialDuration: (f) => `pendant ${f.trialDays} jours`,
    onQuote: 'Sur devis',
    unlimited: 'Illimité',
    compareTitle: 'Comparer les offres',
    allFunctions: 'Toutes les fonctions',
    yes: 'Oui',
    startNote: "Chaque restaurant commence par l'essai gratuit ; l'offre choisie s'applique au premier règlement.",
    rulesTitle: 'Règlement et échéance',
    rules: (f) => [
      `Le règlement se fait par Mobile Money ou par virement à ${f.company}, qui enregistre votre offre et sa date d'échéance. Aucune carte bancaire n'est demandée.`,
      "Sept jours avant l'échéance, un rappel s'affiche pour le propriétaire et l'administrateur.",
      `À l'échéance, rien ne s'arrête : caisse, cuisine, commandes QR et synchronisation continuent. Après ${f.graceDays} jours de grâce, seuls les ajouts d'établissement, de membre ou de serveur local sont refusés jusqu'au renouvellement.`,
      "Changer d'offre garde toutes les données du restaurant.",
    ],
    resources: RESOURCE_LABELS,
    planLabel: (p) => p.label,
    planSummary: (p) => p.summary,
  },

  demo: {
    title: (f) => `Démonstration d'AfriKaisse : essai gratuit de ${f.trialDays} jours`,
    description: (f) =>
      `Créez votre restaurant et essayez AfriKaisse ${f.trialDays} jours : importez des plats, créez vos tables, commandez par QR, encaissez. Captures réelles de l'application.`,
    h1: 'Démonstration',
    lead: (f) =>
      `La démonstration, c'est l'application elle-même : en créant votre restaurant, vous avez ${f.trialDays} jours d'essai avec toutes les fonctions, sans moyen de paiement.`,
    stepsTitle: 'Essayer en sept étapes',
    steps: (f) => [
      {
        title: 'Créer votre restaurant',
        text: "Nom de l'organisation, premier établissement et son type, pays (il propose la devise et le fuseau horaire), votre e-mail et un mot de passe d'au moins 10 caractères.",
        action: 'register',
      },
      {
        title: 'Remplir la carte',
        text: `Menu, puis Importer des plats : choisissez le pays et cochez les plats que vous vendez parmi ${f.catalogueDishes}. Ils arrivent avec leur photo et un prix indicatif à vérifier.`,
      },
      { title: 'Dessiner la salle', text: 'Tables : créez une zone (Salle, Terrasse), puis vos tables. Chaque table reçoit son QR.' },
      { title: 'Commander comme un client', text: "Menu, onglet QR codes : ouvrez le QR d'une table avec votre téléphone et passez une commande." },
      { title: 'Servir', text: 'Commandes : confirmez la commande. Cuisine : passez-la en préparation, puis prête. Elle apparaît prête sur le plan de salle.' },
      { title: 'Encaisser', text: 'Caisse : ouvrez la caisse avec un fond, encaissez la table en espèces ou en Mobile Money, affichez le reçu.' },
      { title: 'Suivre', text: "Tableau de bord : chiffre d'affaires, commandes et meilleures ventes de la journée." },
    ],
    galleryTitle: "Captures de l'application",
    galleryLead: "Captures réelles d'un restaurant de démonstration, prises le 16 septembre 2026 sur la version actuelle : PC, tablette et téléphone du client.",
    moreTitle: 'Tablette Android et serveur local',
    moreText:
      "L'application tablette et l'installateur Windows du serveur local ne sont pas encore en téléchargement libre. Écrivez-nous pour les essayer dans votre restaurant.",
  },

  faq: {
    title: 'Questions fréquentes sur AfriKaisse',
    description: 'Internet, matériel, menu QR, Mobile Money, abonnement, plusieurs établissements, langues, devises et données : les réponses sur AfriKaisse.',
    h1: 'Questions fréquentes',
    lead: 'Fonctionnement, matériel, paiements et abonnement.',
    items: [
      {
        id: 'internet',
        q: 'AfriKaisse fonctionne-t-il sans Internet ?',
        a: () => [
          "Oui, avec le serveur local : AfriKaisse s'installe sur un PC Windows 10 ou 11 du restaurant. La caisse, les commandes des serveurs, l'écran cuisine, le stock et l'impression continuent sur le Wi-Fi du restaurant quand Internet est coupé.",
          'En mode Cloud, sans PC sur place, une connexion Internet est indispensable.',
          'Pendant une coupure, les clients ne peuvent pas commander par QR : leur téléphone passe par Internet. Ils commandent auprès d’un serveur.',
        ],
      },
      {
        id: 'materiel',
        q: 'Quel matériel faut-il ?',
        a: () => [
          'Pour AfriKaisse Cloud, un navigateur à jour sur un ordinateur ou une tablette. Pour la salle et la cuisine, des tablettes Android. Pour travailler sans Internet, un PC Windows 10 ou 11 en 64 bits. Pour les tickets, des imprimantes thermiques réseau de 80 ou 58 mm (Epson, Xprinter…) branchées sur la box.',
        ],
      },
      {
        id: 'clients',
        q: 'Les clients doivent-ils installer une application ?',
        a: () => [
          "Non. Ils scannent le QR de la table avec l'appareil photo de leur téléphone : la carte s'ouvre dans le navigateur, sans compte. Ils utilisent leurs données mobiles, pas le Wi-Fi du restaurant.",
        ],
      },
      {
        id: 'mobile-money',
        q: 'Comment sont gérés les paiements Mobile Money ?',
        a: () => [
          "Le client paie avec son application Mobile Money. Le caissier choisit « Mobile money » dans AfriKaisse et note l'opérateur et le numéro de transaction.",
          "AfriKaisse n'est pas encore relié directement aux opérateurs : aucun argent ne transite par le logiciel.",
        ],
      },
      {
        id: 'tablette',
        q: "Comment obtenir l'application tablette et le serveur local ?",
        a: () => ["L'application Android et l'installateur Windows ne sont pas encore en téléchargement libre. Écrivez-nous pour les recevoir."],
        link: 'contact',
      },
      {
        id: 'echeance',
        q: "Que se passe-t-il à la fin de l'essai ou à l'échéance ?",
        a: (f) => [
          `Rien ne s'arrête : caisse, cuisine, commandes QR et synchronisation continuent. Après ${f.graceDays} jours de grâce, seuls les ajouts d'établissement, de membre ou de serveur local sont refusés jusqu'au règlement.`,
        ],
        link: 'pricing',
      },
      {
        id: 'reglement',
        q: "Comment régler l'abonnement ?",
        a: (f) => [`Par Mobile Money ou par virement à ${f.company}, qui active l'offre et sa date d'échéance. Aucune carte bancaire n'est demandée.`],
      },
      {
        id: 'etablissements',
        q: 'Peut-on gérer plusieurs établissements ?',
        a: (f) => [
          `Oui. L'offre Pro couvre ${f.proLocations} établissements, l'offre Groupe n'a pas de limite. Chaque établissement a ses tables, sa caisse et son mode de fonctionnement ; un membre de l'équipe est rattaché à un établissement ou à tous.`,
        ],
      },
      {
        id: 'langues',
        q: 'Quelles langues et quelles devises ?',
        a: (f) => [
          'Les écrans du personnel sont en français, en anglais et en arabe.',
          `Devises : ${f.currencies}. Le pays choisi à l'inscription propose la devise et le fuseau horaire.`,
        ],
      },
      {
        id: 'donnees',
        q: 'Mes données sont-elles protégées ?',
        a: () => [
          "Dans AfriKaisse Cloud, chaque organisation est isolée des autres, et chaque membre ne voit que les écrans de son rôle. Désactiver un membre coupe son accès sur tous ses appareils.",
          'Avec le serveur local, les données restent sur le PC du restaurant, copiées et vérifiées au démarrage puis toutes les heures. Copiez ce dossier de sauvegardes chaque semaine sur une clé USB.',
        ],
      },
      {
        id: 'impression',
        q: 'Peut-on imprimer sans serveur local ?',
        a: () => [
          'Oui, depuis un ordinateur : le reçu et l’addition sortent en 80 mm par le navigateur. Les tickets de préparation automatiques par poste demandent le serveur local, relié aux imprimantes réseau.',
        ],
      },
      {
        id: 'pc-vole',
        q: 'Le PC du restaurant est volé : que faire ?',
        a: () => [
          'Dans AfriKaisse Cloud, Établissements, puis Serveurs reliés, puis Révoquer : ce PC ne peut plus rien envoyer ni recevoir. Un code relie ensuite le PC de remplacement.',
        ],
      },
      {
        id: 'editeur',
        q: 'Qui édite AfriKaisse ?',
        a: (f) => [`${f.company}, ${f.city}.`],
        link: 'contact',
      },
    ],
  },

  contact: {
    title: (f) => `Contact — AfriKaisse, ${f.company}`,
    description: (f) => `Contacter ${f.company} (${f.city}) pour un devis, l'application tablette, le serveur local ou une question sur AfriKaisse.`,
    h1: 'Contact',
    lead: "Pour un devis, l'application tablette, l'installation du serveur local ou une question sur AfriKaisse.",
    detailsTitle: 'Coordonnées',
    company: 'Éditeur',
    city: 'Ville',
    email: 'E-mail',
    phone: 'Téléphone',
    whatsapp: 'WhatsApp',
    pending: 'Coordonnées en cours de publication.',
    writeTitle: 'Écrire directement',
    subjects: [
      { subject: 'AfriKaisse — devis offre Groupe', label: 'Demander un devis Groupe' },
      { subject: 'AfriKaisse — application tablette et serveur local', label: "Recevoir l'application tablette ou le serveur local" },
      { subject: 'AfriKaisse — question', label: 'Poser une question' },
    ],
    includeTitle: 'À indiquer dans votre message',
    include: [
      'Le nom du restaurant et la ville.',
      "Le nombre d'établissements et de tables.",
      'Le matériel déjà en place : PC, tablettes, imprimantes.',
      'Le mode souhaité : en ligne, ou sur le PC du restaurant sans Internet.',
    ],
    customersTitle: 'Déjà client ?',
    customersText: 'Connectez-vous à AfriKaisse avec votre adresse e-mail et votre mot de passe.',
  },

  notFound: {
    title: 'Page introuvable — AfriKaisse',
    description: "Cette adresse n'existe pas sur le site d'AfriKaisse.",
    h1: 'Page introuvable',
    text: "L'adresse demandée n'existe pas sur ce site. Les pages disponibles :",
  },
};
