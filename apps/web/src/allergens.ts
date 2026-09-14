import type { Allergen } from '@afrikaisse/core';

/** Sans import de valeur depuis le cœur : utilisable par le menu client, qui n'embarque pas Zod. */
export const ALLERGEN_LABELS: Record<Allergen, string> = {
  GLUTEN: 'Gluten',
  CRUSTACEANS: 'Crustacés',
  EGGS: 'Œufs',
  FISH: 'Poisson',
  PEANUTS: 'Arachides',
  SOY: 'Soja',
  MILK: 'Lait',
  NUTS: 'Fruits à coque',
  CELERY: 'Céleri',
  MUSTARD: 'Moutarde',
  SESAME: 'Sésame',
  SULPHITES: 'Sulfites',
  LUPIN: 'Lupin',
  MOLLUSCS: 'Mollusques',
};

/** « 1 choix obligatoire », « jusqu'à 2 choix »… */
export function choiceRule(minSelect: number, maxSelect: number): string {
  if (minSelect === 0) return maxSelect === 1 ? 'facultatif, 1 choix' : `facultatif, jusqu'à ${maxSelect} choix`;
  if (minSelect === maxSelect) return minSelect === 1 ? '1 choix obligatoire' : `${minSelect} choix obligatoires`;
  return `${minSelect} à ${maxSelect} choix`;
}
