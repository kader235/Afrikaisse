/**
 * Thèmes du menu client (QR) : chaque établissement choisit l'apparence de son menu.
 * Module sans Zod : le bundle du menu client l'importe par `@afrikaisse/core/menu-themes`.
 *
 * Chaque thème a deux palettes complètes : `light` (téléphone en mode clair) et `dark`
 * (téléphone en mode sombre). Règle : un thème sombre par nature (`nuit`) donne la même
 * palette aux deux modes, pour rester sombre quel que soit le réglage du téléphone.
 * Toutes les couleurs sont en hexadécimal #rrggbb ; les ombres et voiles sont calculés
 * à partir de `shadowColor` (et `accent`, `action`, `card`, `onAccent`) avec une opacité fixée par la feuille.
 * Design « v3 » (09/2026) : page bleutée, cartes blanches, bleu pour les prix et la catégorie active,
 * et une couleur d'action à part (`action`, bleue) pour ce que le client doit toucher.
 */

export const MENU_THEMES = ['bleu', 'savane', 'nuit', 'foret', 'maquis', 'ocean'] as const;
export type MenuThemeId = (typeof MENU_THEMES)[number];
export const DEFAULT_MENU_THEME: MenuThemeId = 'bleu';

export interface MenuPalette {
  /** Faux : ombres légères ; vrai : ombres plus marquées et `color-scheme: dark`. */
  dark: boolean;
  /** Fond de la page. */
  bg: string;
  /** Cartes, fiches, barre d'onglets du bas. */
  card: string;
  /** Teinte douce de l'accent : lignes choisies, pastilles, catégorie active. */
  soft: string;
  /** Remplissage neutre (champs, emplacement de photo). */
  fill: string;
  /** Traits de séparation. */
  line: string;
  /** Bordures de champs, poignée des fiches, points inactifs sombres. */
  border: string;
  /** Texte principal. */
  text: string;
  /** Texte secondaire. */
  muted: string;
  /** Couleur d'action : boutons, « + », barre du panier. */
  accent: string;
  /** Accent appuyé. */
  accentPress: string;
  /** Prix et texte posé sur `soft`. */
  accentDark: string;
  /** Liens et icônes d'accent posés sur le fond ou une carte. */
  accentText: string;
  /** Texte posé sur l'accent. */
  onAccent: string;
  /** Barre du bas « suivi de commande », bulle d'information. */
  deep: string;
  /** Texte posé sur `deep`. */
  onDeep: string;
  /** Texte secondaire et icônes posés sur `deep`. */
  deepSoft: string;
  /** Bandeau d'annonces et montant de l'addition : dégradé du début (côté texte) à la fin. */
  bannerStart: string;
  bannerEnd: string;
  /** Titre du bandeau. */
  bannerText: string;
  /** Texte secondaire du bandeau. */
  bannerSoft: string;
  /** Bouton du bandeau et son texte. */
  bannerCta: string;
  bannerCtaText: string;
  /** Case à cocher vide. */
  tick: string;
  /** Bouton désactivé et son texte. */
  disabled: string;
  onDisabled: string;
  /** Points du bandeau (inactifs). */
  dot: string;
  danger: string;
  dangerSoft: string;
  /** Base des ombres et du voile derrière les fiches. */
  shadowColor: string;
  /** Couleur de l'action principale (« + », bouton central du panier, « Commander », « Ajouter ») : bleue (plus de bouton jaune). */
  action: string;
  /** Action appuyée. */
  actionPress: string;
  /** Texte et icône posés sur `action`. */
  onAction: string;
  /** Point « ouvert » de l'en-tête et signaux « en direct ». */
  live: string;
}

export interface MenuTheme {
  id: MenuThemeId;
  label: string;
  description: string;
  light: MenuPalette;
  dark: MenuPalette;
}

export const MENU_PALETTE_KEYS = [
  'bg',
  'card',
  'soft',
  'fill',
  'line',
  'border',
  'text',
  'muted',
  'accent',
  'accentPress',
  'accentDark',
  'accentText',
  'onAccent',
  'deep',
  'onDeep',
  'deepSoft',
  'bannerStart',
  'bannerEnd',
  'bannerText',
  'bannerSoft',
  'bannerCta',
  'bannerCtaText',
  'tick',
  'disabled',
  'onDisabled',
  'dot',
  'danger',
  'dangerSoft',
  'shadowColor',
  'action',
  'actionPress',
  'onAction',
  'live',
] as const satisfies readonly Exclude<keyof MenuPalette, 'dark'>[];
export type MenuColorKey = (typeof MENU_PALETTE_KEYS)[number];

const bleu: MenuTheme = {
  id: 'bleu',
  label: 'Bleu AfriKaisse',
  description: 'Clair et net, bleu de confiance, boutons bleus. Convient à tous les établissements.',
  light: {
    dark: false,
    bg: '#eef2f8',
    card: '#ffffff',
    soft: '#eef3ff',
    fill: '#f3f6fb',
    line: '#e3e8f1',
    border: '#d5dce8',
    text: '#0f1f40',
    muted: '#5b6478',
    accent: '#1d4ed8',
    accentPress: '#1a43bd',
    accentDark: '#1d4ed8',
    accentText: '#1d4ed8',
    onAccent: '#ffffff',
    deep: '#0b1730',
    onDeep: '#ffffff',
    deepSoft: '#bfdbfe',
    bannerStart: '#0b1730',
    bannerEnd: '#1d4ed8',
    bannerText: '#ffffff',
    bannerSoft: '#c9d8ff',
    bannerCta: '#ffffff',
    bannerCtaText: '#1d4ed8',
    tick: '#cbd3e1',
    disabled: '#c3cbd9',
    onDisabled: '#ffffff',
    dot: '#c7d2e6',
    danger: '#c62828',
    dangerSoft: '#fdecec',
    shadowColor: '#0b1730',
    action: '#1d4ed8',
    actionPress: '#1a43bd',
    onAction: '#ffffff',
    live: '#16a34a',
  },
  dark: {
    dark: true,
    bg: '#0b1220',
    card: '#141d30',
    soft: '#19295a',
    fill: '#1b2539',
    line: '#243049',
    border: '#34425e',
    text: '#e7ecf6',
    muted: '#9aa5ba',
    accent: '#2f63e8',
    accentPress: '#2754cc',
    accentDark: '#a9c1ff',
    accentText: '#8fb0ff',
    onAccent: '#ffffff',
    deep: '#0a1630',
    onDeep: '#ffffff',
    deepSoft: '#bfdbfe',
    bannerStart: '#0b1730',
    bannerEnd: '#1d4ed8',
    bannerText: '#ffffff',
    bannerSoft: '#c9d8ff',
    bannerCta: '#ffffff',
    bannerCtaText: '#1d4ed8',
    tick: '#4a5873',
    disabled: '#34425e',
    onDisabled: '#9aa5ba',
    dot: '#34425e',
    danger: '#f28b82',
    dangerSoft: '#3a1f24',
    shadowColor: '#000000',
    action: '#2f63e8',
    actionPress: '#2754cc',
    onAction: '#ffffff',
    live: '#4ade80',
  },
};

const savane: MenuTheme = {
  id: 'savane',
  label: 'Savane',
  description: 'Orange chaleureux sur fond crème. Grillades, fast-food, cuisine familiale.',
  light: {
    dark: false,
    bg: '#fbf6ef',
    card: '#ffffff',
    soft: '#fdeee2',
    fill: '#f4ede3',
    line: '#efe4d6',
    border: '#e2d3c1',
    text: '#2b1a0e',
    muted: '#6f5d4a',
    accent: '#c2410c',
    accentPress: '#a8380a',
    accentDark: '#9a3412',
    accentText: '#b83d0b',
    onAccent: '#ffffff',
    deep: '#3b1d0c',
    onDeep: '#ffffff',
    deepSoft: '#fed7aa',
    bannerStart: '#4a1f08',
    bannerEnd: '#c2410c',
    bannerText: '#ffffff',
    bannerSoft: '#ffe1c7',
    bannerCta: '#ffffff',
    bannerCtaText: '#b83d0b',
    tick: '#ddccb7',
    disabled: '#d9cab8',
    onDisabled: '#ffffff',
    dot: '#e6d5c1',
    danger: '#b42318',
    dangerSoft: '#fdece9',
    shadowColor: '#4a2408',
    action: '#c2410c',
    actionPress: '#a8380a',
    onAction: '#ffffff',
    live: '#16a34a',
  },
  dark: {
    dark: true,
    bg: '#16100b',
    card: '#221912',
    soft: '#3d2515',
    fill: '#2a2018',
    line: '#34291f',
    border: '#4b3c2f',
    text: '#f6ede4',
    muted: '#b6a695',
    accent: '#c2410c',
    accentPress: '#a8380a',
    accentDark: '#ffbd8a',
    accentText: '#ffa266',
    onAccent: '#ffffff',
    deep: '#110b07',
    onDeep: '#ffffff',
    deepSoft: '#fed7aa',
    bannerStart: '#4a1f08',
    bannerEnd: '#c2410c',
    bannerText: '#ffffff',
    bannerSoft: '#ffe1c7',
    bannerCta: '#ffffff',
    bannerCtaText: '#b83d0b',
    tick: '#5d4b3b',
    disabled: '#4b3c2f',
    onDisabled: '#b6a695',
    dot: '#4b3c2f',
    danger: '#f28b82',
    dangerSoft: '#3a1f1c',
    shadowColor: '#000000',
    action: '#c2410c',
    actionPress: '#a8380a',
    onAction: '#ffffff',
    live: '#4ade80',
  },
};

const nuitPalette: MenuPalette = {
  dark: true,
  bg: '#0e1320',
  card: '#171e2e',
  soft: '#2c2817',
  fill: '#1d2536',
  line: '#263045',
  border: '#36415a',
  text: '#eef0f5',
  muted: '#a3abbd',
  accent: '#d4a64a',
  accentPress: '#bf923a',
  accentDark: '#e8c270',
  accentText: '#e2b75a',
  onAccent: '#1a1206',
  deep: '#070a12',
  onDeep: '#f2f3f7',
  deepSoft: '#e8c270',
  bannerStart: '#1b2438',
  bannerEnd: '#6b5220',
  bannerText: '#ffffff',
  bannerSoft: '#ddd3bd',
  bannerCta: '#d4a64a',
  bannerCtaText: '#1a1206',
  tick: '#4a5570',
  disabled: '#36415a',
  onDisabled: '#a3abbd',
  dot: '#36415a',
  danger: '#f28b82',
  dangerSoft: '#3a1f24',
  shadowColor: '#000000',
  action: '#2f63e8',
  actionPress: '#2754cc',
  onAction: '#ffffff',
  live: '#4ade80',
};

const nuit: MenuTheme = {
  id: 'nuit',
  label: 'Nuit',
  description: 'Sombre et élégant, touches dorées. Lounges, bars, restaurants du soir.',
  light: nuitPalette,
  dark: nuitPalette,
};

const foret: MenuTheme = {
  id: 'foret',
  label: 'Forêt',
  description: 'Vert frais et naturel. Cuisine saine, jus, salades, cafés.',
  light: {
    dark: false,
    bg: '#f3f7f3',
    card: '#ffffff',
    soft: '#e2f3e7',
    fill: '#eaf0ea',
    line: '#dfe8df',
    border: '#cbd8cc',
    text: '#10261a',
    muted: '#53645a',
    accent: '#15803d',
    accentPress: '#116b33',
    accentDark: '#14532d',
    accentText: '#15803d',
    onAccent: '#ffffff',
    deep: '#0f2a1c',
    onDeep: '#ffffff',
    deepSoft: '#bbf7d0',
    bannerStart: '#0f2a1c',
    bannerEnd: '#15803d',
    bannerText: '#ffffff',
    bannerSoft: '#c9f0d6',
    bannerCta: '#ffffff',
    bannerCtaText: '#15803d',
    tick: '#c5d4c7',
    disabled: '#c2cfc4',
    onDisabled: '#ffffff',
    dot: '#c3d6c6',
    danger: '#c62828',
    dangerSoft: '#fdecec',
    shadowColor: '#0f2a1c',
    action: '#15803d',
    actionPress: '#116b33',
    onAction: '#ffffff',
    live: '#16a34a',
  },
  dark: {
    dark: true,
    bg: '#0b140f',
    card: '#132019',
    soft: '#173a25',
    fill: '#1a281f',
    line: '#223328',
    border: '#31473a',
    text: '#e6f0e9',
    muted: '#9bb0a2',
    accent: '#15803d',
    accentPress: '#116b33',
    accentDark: '#86efac',
    accentText: '#6ee7a0',
    onAccent: '#ffffff',
    deep: '#07100b',
    onDeep: '#ffffff',
    deepSoft: '#bbf7d0',
    bannerStart: '#0f2a1c',
    bannerEnd: '#15803d',
    bannerText: '#ffffff',
    bannerSoft: '#c9f0d6',
    bannerCta: '#ffffff',
    bannerCtaText: '#15803d',
    tick: '#47604f',
    disabled: '#31473a',
    onDisabled: '#9bb0a2',
    dot: '#31473a',
    danger: '#f28b82',
    dangerSoft: '#3a1f24',
    shadowColor: '#000000',
    action: '#15803d',
    actionPress: '#116b33',
    onAction: '#ffffff',
    live: '#4ade80',
  },
};

const maquis: MenuTheme = {
  id: 'maquis',
  label: 'Maquis',
  description: 'Terre cuite et rouge profond. Maquis, braisés, cuisine africaine.',
  light: {
    dark: false,
    bg: '#faf4f0',
    card: '#ffffff',
    soft: '#f9e5dd',
    fill: '#f3e9e4',
    line: '#ecdfd8',
    border: '#dccbc2',
    text: '#2a1510',
    muted: '#6e5a52',
    accent: '#b33a24',
    accentPress: '#9a311e',
    accentDark: '#8a2c1b',
    accentText: '#a8361f',
    onAccent: '#ffffff',
    deep: '#3a150e',
    onDeep: '#ffffff',
    deepSoft: '#fbcfbf',
    bannerStart: '#4a1a10',
    bannerEnd: '#b33a24',
    bannerText: '#ffffff',
    bannerSoft: '#f7d5c8',
    bannerCta: '#ffffff',
    bannerCtaText: '#a8361f',
    tick: '#dcc9c0',
    disabled: '#d8c6bd',
    onDisabled: '#ffffff',
    dot: '#e2cfc5',
    danger: '#b3261e',
    dangerSoft: '#fdecea',
    shadowColor: '#4a1a10',
    action: '#b33a24',
    actionPress: '#9a311e',
    onAction: '#ffffff',
    live: '#16a34a',
  },
  dark: {
    dark: true,
    bg: '#160e0b',
    card: '#221612',
    soft: '#3d1f17',
    fill: '#2a1c17',
    line: '#34241e',
    border: '#4b3830',
    text: '#f5e9e4',
    muted: '#b8a39a',
    accent: '#b33a24',
    accentPress: '#9a311e',
    accentDark: '#ffb4a0',
    accentText: '#ff9d85',
    onAccent: '#ffffff',
    deep: '#0f0806',
    onDeep: '#ffffff',
    deepSoft: '#fbcfbf',
    bannerStart: '#4a1a10',
    bannerEnd: '#b33a24',
    bannerText: '#ffffff',
    bannerSoft: '#f7d5c8',
    bannerCta: '#ffffff',
    bannerCtaText: '#a8361f',
    tick: '#5e4a42',
    disabled: '#4b3830',
    onDisabled: '#b8a39a',
    dot: '#4b3830',
    danger: '#f28b82',
    dangerSoft: '#3a1f24',
    shadowColor: '#000000',
    action: '#b33a24',
    actionPress: '#9a311e',
    onAction: '#ffffff',
    live: '#4ade80',
  },
};

const ocean: MenuTheme = {
  id: 'ocean',
  label: 'Océan',
  description: 'Bleu-vert apaisant. Poissons, fruits de mer, hôtels, terrasses.',
  light: {
    dark: false,
    bg: '#f1f7f8',
    card: '#ffffff',
    soft: '#ddf2f3',
    fill: '#e7eff1',
    line: '#dbe7ea',
    border: '#c6d6db',
    text: '#0c2329',
    muted: '#50656b',
    accent: '#0f766e',
    accentPress: '#0c625b',
    accentDark: '#115e59',
    accentText: '#0f766e',
    onAccent: '#ffffff',
    deep: '#0b2b33',
    onDeep: '#ffffff',
    deepSoft: '#a5f3fc',
    bannerStart: '#0b2b33',
    bannerEnd: '#0f766e',
    bannerText: '#ffffff',
    bannerSoft: '#c3ecee',
    bannerCta: '#ffffff',
    bannerCtaText: '#0f766e',
    tick: '#c3d4d8',
    disabled: '#bfd0d4',
    onDisabled: '#ffffff',
    dot: '#c2d7db',
    danger: '#c62828',
    dangerSoft: '#fdecec',
    shadowColor: '#0b2b33',
    action: '#0f766e',
    actionPress: '#0c625b',
    onAction: '#ffffff',
    live: '#16a34a',
  },
  dark: {
    dark: true,
    bg: '#0a1417',
    card: '#122125',
    soft: '#123a3b',
    fill: '#172a2e',
    line: '#1f3439',
    border: '#2f4a50',
    text: '#e4f0f2',
    muted: '#97adb2',
    accent: '#0f766e',
    accentPress: '#0c625b',
    accentDark: '#7fe0d6',
    accentText: '#5fd4c8',
    onAccent: '#ffffff',
    deep: '#061013',
    onDeep: '#ffffff',
    deepSoft: '#a5f3fc',
    bannerStart: '#0b2b33',
    bannerEnd: '#0f766e',
    bannerText: '#ffffff',
    bannerSoft: '#c3ecee',
    bannerCta: '#ffffff',
    bannerCtaText: '#0f766e',
    tick: '#455f65',
    disabled: '#2f4a50',
    onDisabled: '#97adb2',
    dot: '#2f4a50',
    danger: '#f28b82',
    dangerSoft: '#3a1f24',
    shadowColor: '#000000',
    action: '#0f766e',
    actionPress: '#0c625b',
    onAction: '#ffffff',
    live: '#4ade80',
  },
};

export const MENU_THEME_LIST: readonly MenuTheme[] = [bleu, savane, nuit, foret, maquis, ocean];

export function isMenuThemeId(value: unknown): value is MenuThemeId {
  return typeof value === 'string' && (MENU_THEMES as readonly string[]).includes(value);
}

/** Thème connu, ou le thème par défaut (valeur absente, ancienne ou inconnue). */
export function menuTheme(id: string | null | undefined): MenuTheme {
  return MENU_THEME_LIST.find((t) => t.id === id) ?? bleu;
}

/** « #1d4ed8 » → « 29, 78, 216 » (pour `rgba(var(--x), a)`, accepté par Chrome 83). */
export function hexToRgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

const cssName = (key: string) => `--m-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Variables CSS d'une palette : une par couleur, plus les triplets et les ombres calculées. */
export function menuPaletteVars(p: MenuPalette): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of MENU_PALETTE_KEYS) vars[cssName(key)] = p[key];
  vars['--m-accent-rgb'] = hexToRgbTriplet(p.accent);
  vars['--m-on-accent-rgb'] = hexToRgbTriplet(p.onAccent);
  vars['--m-action-rgb'] = hexToRgbTriplet(p.action);
  vars['--m-card-rgb'] = hexToRgbTriplet(p.card);
  vars['--m-shadow-rgb'] = hexToRgbTriplet(p.shadowColor);
  const s = vars['--m-shadow-rgb'];
  vars['--m-shadow'] = p.dark ? `0 2px 10px rgba(${s}, 0.3)` : `0 2px 10px rgba(${s}, 0.05)`;
  vars['--m-shadow-lg'] = p.dark ? `0 4px 16px rgba(${s}, 0.35)` : `0 4px 14px rgba(${s}, 0.07)`;
  vars['--m-shadow-pop'] = p.dark ? `0 10px 30px rgba(${s}, 0.5)` : `0 10px 30px rgba(${s}, 0.18)`;
  return vars;
}

const block = (p: MenuPalette) =>
  `${Object.entries(menuPaletteVars(p))
    .map(([k, v]) => `${k}:${v};`)
    .join('')}color-scheme:${p.dark ? 'dark' : 'light'};`;

/** Feuille à injecter après menu.css : palette claire, et palette sombre si le téléphone est en mode sombre. */
export function menuThemeCss(id: string | null | undefined): string {
  const theme = menuTheme(id);
  return `:root{${block(theme.light)}}@media (prefers-color-scheme: dark){:root{${block(theme.dark)}}}`;
}

// --- Contraste (WCAG 2) ------------------------------------------------------

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
