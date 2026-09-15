/**
 * Photo d'exemple d'un plat sans photo : on cherche le plat le plus proche dans le catalogue livré avec
 * l'application (apps/web/public/catalogue). Sans Zod : le menu client l'importe par « @afrikaisse/core/dish-photos ».
 *
 * Prudence avant tout : une mauvaise photo est pire que pas de photo. On n'accepte qu'un nom identique,
 * ou au moins la moitié des mots en commun dont un mot significatif (4 lettres ou plus, autre que « sauce »).
 * « Jus de bissap » ne prend donc pas la photo du jus de baobab : seul « jus » est commun.
 */

export interface DishPhotoSource {
  name: string;
  image: string | null;
}

const STOPWORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'au', 'aux', 'a', 'et', 'en', 'avec', 'cl', 'ml', 'l', 'g', 'kg', 'piece', 'pieces', 'pcs']);

/** Mots trop généraux pour identifier un plat : comptent à moitié et ne suffisent jamais seuls. */
const WEAK = new Set(['sauce']);

const weight = (token: string) => (WEAK.has(token) ? 0.5 : 1);

function tokens(text: string): string[] {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/** Le nom sans parenthèses, et le contenu des parenthèses comme autre nom (« Kissar (dafa) »). */
function variants(name: string): string[][] {
  const base = tokens(name.replace(/\([^)]*\)/g, ' '));
  const aliases = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => tokens(m[1] ?? ''));
  return [base, ...aliases].filter((t) => t.length > 0);
}

function score(a: string[], b: string[]): number {
  if (a.join(' ') === b.join(' ')) return 2; // nom identique : meilleur que tout recouvrement partiel
  const inB = new Set(b);
  const shared = a.filter((t) => inB.has(t));
  if (!shared.some((t) => t.length >= 4 && !WEAK.has(t))) return 0;
  const sum = (list: string[]) => list.reduce((s, t) => s + weight(t), 0);
  const value = sum(shared) / Math.max(sum(a), sum(b));
  return value >= 0.5 ? value : 0;
}

/** `/catalogue/images/<fichier>` du plat du catalogue le plus proche, ou null s'il n'y en a pas d'assez sûr. */
export function dishPhotoFor(name: string, dishes: readonly DishPhotoSource[]): string | null {
  const wanted = variants(name);
  if (wanted.length === 0) return null;
  let best = 0;
  let image: string | null = null;
  for (const dish of dishes) {
    if (!dish.image) continue;
    const candidates = [...variants(dish.name), tokens(dish.image.replace(/\.[a-z0-9]+$/i, ''))];
    for (const w of wanted) {
      for (const c of candidates) {
        const s = score(w, c);
        if (s > best) {
          best = s;
          image = dish.image;
        }
      }
    }
  }
  return image ? `/catalogue/images/${image}` : null;
}
