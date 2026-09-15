import { DEFAULT_CLOUD_URL } from '@afrikaisse/core';

/**
 * Coordonnées publiées sur le site. C'est le SEUL fichier à modifier pour les changer,
 * puis reconstruire (`npm run build:site`).
 *
 * Règle : ne jamais inventer un numéro. Une valeur `null` masque la ligne sur le site.
 */
export interface SiteConfig {
  /** Éditeur du logiciel. */
  company: string;
  city: string;
  /** Adresse de contact commerciale. À CONFIRMER : voir docs/WEB.md, « Site public ». */
  email: string | null;
  /** Téléphone au format international lisible, par exemple « +235 66 00 00 00 ». */
  phone: string | null;
  /** Numéro WhatsApp au format international, chiffres seulement, par exemple « 23566000000 ». */
  whatsapp: string | null;
}

export const SITE_CONFIG: SiteConfig = {
  company: 'GLOBALTECH BUSINESS TD',
  city: "N'Djamena, Tchad",
  email: 'contact@afrikaisse.com',
  phone: null,
  whatsapp: null,
};

/** Adresse de l'application (Connexion, Créer mon restaurant). Variable de build : SITE_APP_URL. */
export const DEFAULT_APP_URL = DEFAULT_CLOUD_URL;

/** Adresse publique du site lui-même (liens canoniques, sitemap, Open Graph). Variable de build : SITE_URL. */
export const DEFAULT_SITE_URL = 'https://www.afrikaisse.dametta.com';

const origin = (value: string, name: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} n'est pas une adresse valide : « ${value} »`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} doit commencer par https:// : « ${value} »`);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};

export function resolveUrls(env: Record<string, string | undefined> = process.env): { appUrl: string; siteUrl: string } {
  return {
    appUrl: origin(env.SITE_APP_URL?.trim() || DEFAULT_APP_URL, 'SITE_APP_URL'),
    siteUrl: origin(env.SITE_URL?.trim() || DEFAULT_SITE_URL, 'SITE_URL'),
  };
}
