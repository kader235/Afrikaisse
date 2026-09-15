import { fr } from './fr.ts';
import type { SiteText } from './types.ts';

export type * from './types.ts';

/**
 * Langues du site. Le français seul pour l'instant ; pour ajouter l'anglais ou l'arabe :
 * un fichier `en.ts` / `ar.ts` typé `SiteText`, une entrée ici avec son préfixe (`/en`, `/ar`)
 * et `dir: 'rtl'` pour l'arabe (la feuille de styles est écrite en propriétés logiques).
 */
export interface LocaleDef {
  code: 'fr';
  lang: string;
  dir: 'ltr' | 'rtl';
  ogLocale: string;
  /** Préfixe des adresses : '' pour la langue principale. */
  prefix: string;
  text: SiteText;
}

export const LOCALES: Record<LocaleDef['code'], LocaleDef> = {
  fr: { code: 'fr', lang: 'fr', dir: 'ltr', ogLocale: 'fr_FR', prefix: '', text: fr },
};
