import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEMORY_PAIRS, canFlip, createMemoryGame, flipCard, hideMismatch, isMismatch, isWon, seededRandom, shuffle, type MemoryState } from '../src/memoryGame.ts';

const FACES = ['poulet', 'poisson', 'alloco', 'bissap', 'riz', 'brochette'];

/** Positions des deux cartes de chaque face. */
function pairsOf(state: MemoryState): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const card of state.cards) map.set(card.face, [...(map.get(card.face) ?? []), card.index]);
  return map;
}

describe('Jeu du mémo — logique', () => {
  it('sans Zod : importable par le menu client', () => {
    const source = readFileSync(new URL('../src/memoryGame.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]zod['"]/);
    expect(source).not.toMatch(/^import /m);
  });

  it('mélange reproductible : même graine, même ordre ; autre graine, autre ordre ; rien de perdu', () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(shuffle(items, 42)).toEqual(shuffle(items, 42));
    expect(shuffle(items, 42)).not.toEqual(shuffle(items, 43));
    expect(shuffle(items, 42).slice().sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual(Array.from({ length: 12 }, (_, i) => i));
    const random = seededRandom(7);
    for (let i = 0; i < 100; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('12 cartes : chaque face deux fois, faces en double ignorées', () => {
    const game = createMemoryGame([...FACES, 'poulet'], 1);
    expect(MEMORY_PAIRS).toBe(6);
    expect(game.cards).toHaveLength(12);
    expect(game.cards.map((c) => c.index)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    for (const positions of pairsOf(game).values()) expect(positions).toHaveLength(2);
    expect(createMemoryGame(FACES, 1)).toEqual(createMemoryGame(FACES, 1));
    expect(game.moves).toBe(0);
    expect(isWon(game)).toBe(false);
  });

  it('paire trouvée : les deux cartes restent visibles et le coup compte', () => {
    const game = createMemoryGame(FACES, 5);
    const [a, b] = pairsOf(game).get('riz')!;
    let s = flipCard(game, a!);
    expect(s.flipped).toEqual([a]);
    expect(s.moves).toBe(0);
    expect(flipCard(s, a!)).toBe(s); // toucher la même carte ne fait rien
    s = flipCard(s, b!);
    expect(s.matched).toEqual([a, b]);
    expect(s.flipped).toEqual([]);
    expect(s.moves).toBe(1);
    expect(canFlip(s, a!)).toBe(false);
    expect(flipCard(s, b!)).toBe(s);
  });

  it('paire manquée : les deux cartes restent visibles, puis se cachent (ou au coup suivant)', () => {
    const game = createMemoryGame(FACES, 9);
    const pairs = pairsOf(game);
    const [x] = pairs.get('poulet')!;
    const [y, y2] = pairs.get('poisson')!;
    let s = flipCard(flipCard(game, x!), y!);
    expect(isMismatch(s)).toBe(true);
    expect(s.moves).toBe(1);
    expect(s.matched).toEqual([]);
    expect(hideMismatch(s).flipped).toEqual([]);
    // Toucher une troisième carte cache la paire manquée et retourne la nouvelle.
    s = flipCard(s, y2!);
    expect(s.flipped).toEqual([y2]);
    expect(s.moves).toBe(1);
    s = flipCard(s, y!);
    expect(s.matched).toEqual([y2, y]);
    expect(s.moves).toBe(2);
  });

  it('victoire quand toutes les paires sont trouvées, en 6 coups au mieux', () => {
    let s = createMemoryGame(FACES, 123);
    for (const [first, second] of pairsOf(s).values()) {
      expect(isWon(s)).toBe(false);
      s = flipCard(flipCard(s, first!), second!);
    }
    expect(isWon(s)).toBe(true);
    expect(s.moves).toBe(6);
    expect(isWon(createMemoryGame([], 1))).toBe(false);
    expect(flipCard(s, 99)).toBe(s);
  });
});
