/**
 * Titre du menu client quand l'établissement a un slogan : taille de police selon la longueur,
 * pour tenir en trois lignes au plus sur un téléphone (partagé avec l'aperçu de l'onglet « Thème du menu »).
 */
export type SloganSize = 'lg' | 'md' | 'sm';

export function sloganSize(slogan: string): SloganSize {
  const length = slogan.length;
  if (length <= 32) return 'lg';
  if (length <= 56) return 'md';
  return 'sm';
}

const NBSP = ' ';

/** Typographie française : espace insécable avant « ! ? : ; » et à l'intérieur des guillemets, pour ne jamais laisser un « ! » seul en fin de titre. */
export function sloganText(slogan: string): string {
  return slogan.replace(/ ([!?:;»])/g, `${NBSP}$1`).replace(/« /g, `«${NBSP}`);
}
