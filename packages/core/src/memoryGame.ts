/**
 * « Jeu du mémo » du menu client : retrouver les paires de cartes pendant que la commande se prépare.
 * Logique pure et sans Zod (le bundle du menu l'importe par `@afrikaisse/core/memory-game`) :
 * état immuable, mélange reproductible par graine, aucune horloge ni aléa caché.
 */

export const MEMORY_PAIRS = 6;

export interface MemoryCard {
  /** Position sur la grille (0 à 2 × paires − 1). */
  index: number;
  /** Deux cartes forment une paire quand elles ont la même face. */
  face: string;
}

export interface MemoryState {
  cards: readonly MemoryCard[];
  /** Cartes retournées et pas encore trouvées : 0, 1 ou 2 (deux cartes différentes restent visibles jusqu'au coup suivant). */
  flipped: readonly number[];
  /** Positions des cartes déjà trouvées. */
  matched: readonly number[];
  /** Coups joués : un coup = deux cartes retournées. */
  moves: number;
}

/** Générateur pseudo-aléatoire (mulberry32) : même graine, même suite. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mélange de Fisher-Yates reproductible ; la liste d'origine n'est pas modifiée. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const random = seededRandom(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Nouvelle partie : chaque face (distincte) apparaît deux fois, cartes mélangées selon la graine. */
export function createMemoryGame(faces: readonly string[], seed: number): MemoryState {
  const unique = [...new Set(faces)];
  const deck = shuffle([...unique, ...unique], seed);
  return { cards: deck.map((face, index) => ({ index, face })), flipped: [], matched: [], moves: 0 };
}

/** Une carte peut-elle être retournée maintenant ? (ni trouvée, ni déjà visible) */
export function canFlip(state: MemoryState, index: number): boolean {
  return index >= 0 && index < state.cards.length && !state.matched.includes(index) && !state.flipped.includes(index);
}

/**
 * Retourner une carte. Deux cartes différentes restent visibles : toucher une troisième carte les cache
 * d'abord (ou appeler `hideMismatch`). La deuxième carte d'un coup compte le coup et, si les faces sont
 * identiques, la paire est trouvée tout de suite.
 */
export function flipCard(state: MemoryState, index: number): MemoryState {
  const base = state.flipped.length >= 2 ? hideMismatch(state) : state;
  if (!canFlip(base, index)) return state;
  if (base.flipped.length === 0) return { ...base, flipped: [index] };
  const first = base.flipped[0]!;
  const moves = base.moves + 1;
  if (base.cards[first]!.face === base.cards[index]!.face) {
    return { ...base, flipped: [], matched: [...base.matched, first, index], moves };
  }
  return { ...base, flipped: [first, index], moves };
}

/** Deux cartes différentes visibles ? */
export function isMismatch(state: MemoryState): boolean {
  return state.flipped.length === 2;
}

/** Cache les deux cartes d'une paire manquée. */
export function hideMismatch(state: MemoryState): MemoryState {
  return state.flipped.length === 2 ? { ...state, flipped: [] } : state;
}

export function isWon(state: MemoryState): boolean {
  return state.cards.length > 0 && state.matched.length === state.cards.length;
}
