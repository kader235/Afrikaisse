import type { LimitedResource, PlanDefinition } from '@afrikaisse/core';

/** Captures réelles de l'application (public/captures/<id>-720.webp et -1440.webp). */
export type CaptureId = 'caisse' | 'tableau-de-bord' | 'tables' | 'menu';

/** Destinations d'un bouton : les adresses réelles sont calculées au build. */
export type LinkTarget = 'register' | 'login' | 'pricing' | 'contact' | 'demo' | 'features';

/**
 * Faits calculés au build à partir du code (offres, devises, catalogue, coordonnées).
 * Les textes les citent : un prix ou une limite n'est jamais recopié à la main.
 */
export interface TextFacts {
  company: string;
  city: string;
  trialDays: number;
  graceDays: number;
  /** Liste lisible des devises gérées. */
  currencies: string;
  catalogueDishes: number;
  cataloguePhotos: number;
  /** Liste lisible des groupes du catalogue de plats. */
  catalogueGroups: string;
  /** Nombre d'établissements de l'offre Pro, en texte (« 3 » ou « illimité »). */
  proLocations: string;
  /** Nom d'hôte de l'application, par exemple afrikaisse.dametta.com. */
  appHost: string;
  /** Résumé des offres et de leurs prix, pour les descriptions. */
  plansSummary: string;
}

export interface FactRow {
  id: 'hors-ligne' | 'tablette' | 'menu-qr' | 'paiements' | 'impression' | 'etablissements' | 'devises' | 'langues';
  label: string;
  text: string;
}

export interface FeatureSection {
  id: string;
  title: string;
  points: string[];
  capture?: CaptureId;
}

export interface Step {
  title: string;
  text: string;
  action?: LinkTarget;
}

export interface FaqItem {
  id: string;
  q: string;
  a: (f: TextFacts) => string[];
  link?: LinkTarget;
}

/** Tout le texte du site pour une langue. Le français est la référence ; l'anglais et l'arabe suivront ce contrat. */
export interface SiteText {
  skip: string;
  ogImageAlt: string;
  nav: { home: string; features: string; pricing: string; demo: string; faq: string; contact: string; menu: string; main: string; mobile: string; brandHome: string };
  actions: { login: string; register: string; pricing: string; features: string; compare: string; quote: string; contact: string; demo: string; faq: string };
  captures: { caption: string; items: Record<CaptureId, { title: string; alt: string }> };
  footer: { tagline: (f: TextFacts) => string; product: string; access: string; language: string; prices: string };
  home: {
    title: string;
    description: (f: TextFacts) => string;
    h1: string;
    lead: string;
    trial: (f: TextFacts) => string;
    factsTitle: string;
    facts: (f: TextFacts) => FactRow[];
    modulesTitle: string;
    modules: { id: string; title: string; text: string }[];
    flowTitle: string;
    flow: Step[];
    modesTitle: string;
    modesLead: string;
    modesCriterion: string;
    modesCloud: string;
    modesLocal: string;
    modes: (f: TextFacts) => [string, string, string][];
    catalogueTitle: string;
    catalogueText: (f: TextFacts) => string;
    catalogueNote: string;
    dishAlt: (name: string) => string;
    pricingLead: string;
    ctaTitle: string;
    ctaText: (f: TextFacts) => string;
  };
  features: { title: string; description: string; h1: string; lead: string; toc: string; sections: (f: TextFacts) => FeatureSection[] };
  pricing: {
    title: string;
    description: (f: TextFacts) => string;
    h1: string;
    lead: string;
    offer: string;
    price: string;
    summary: string;
    free: string;
    perMonth: string;
    trialDuration: (f: TextFacts) => string;
    onQuote: string;
    unlimited: string;
    compareTitle: string;
    allFunctions: string;
    yes: string;
    startNote: string;
    rulesTitle: string;
    rules: (f: TextFacts) => string[];
    resources: Record<LimitedResource, string>;
    planLabel: (p: PlanDefinition) => string;
    planSummary: (p: PlanDefinition) => string;
  };
  demo: {
    title: (f: TextFacts) => string;
    description: (f: TextFacts) => string;
    h1: string;
    lead: (f: TextFacts) => string;
    stepsTitle: string;
    steps: (f: TextFacts) => Step[];
    galleryTitle: string;
    galleryLead: string;
    moreTitle: string;
    moreText: string;
  };
  faq: { title: string; description: string; h1: string; lead: string; items: FaqItem[] };
  contact: {
    title: (f: TextFacts) => string;
    description: (f: TextFacts) => string;
    h1: string;
    lead: string;
    detailsTitle: string;
    company: string;
    city: string;
    email: string;
    phone: string;
    whatsapp: string;
    pending: string;
    writeTitle: string;
    subjects: { subject: string; label: string }[];
    includeTitle: string;
    include: string[];
    customersTitle: string;
    customersText: string;
  };
  notFound: { title: string; description: string; h1: string; text: string };
}
