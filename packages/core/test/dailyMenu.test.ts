import { describe, expect, it } from 'vitest';
import { dailyMenuInputSchema, pickDailyMenu } from '../src/index.ts';

const menu = (id: string, startDate: string, endDate: string, updatedAt = 1) => ({ id, startDate, endDate, updatedAt });

describe('Menu du jour — menu en vigueur', () => {
  it('aucun menu : null (toute la carte)', () => {
    expect(pickDailyMenu([], '2026-09-19')).toBeNull();
    expect(pickDailyMenu([menu('a', '2026-09-20', '2026-09-22')], '2026-09-19')).toBeNull();
    expect(pickDailyMenu([menu('a', '2026-09-10', '2026-09-18')], '2026-09-19')).toBeNull();
  });

  it('bornes incluses', () => {
    const p = menu('p', '2026-09-19', '2026-09-21');
    expect(pickDailyMenu([p], '2026-09-19')?.id).toBe('p');
    expect(pickDailyMenu([p], '2026-09-21')?.id).toBe('p');
    expect(pickDailyMenu([p], '2026-09-22')).toBeNull();
  });

  it("un menu d'un seul jour l'emporte sur une période, même plus ancien", () => {
    const periode = menu('periode', '2026-09-15', '2026-09-25', 900);
    const jour = menu('jour', '2026-09-19', '2026-09-19', 100);
    expect(pickDailyMenu([periode, jour], '2026-09-19')?.id).toBe('jour');
    expect(pickDailyMenu([jour, periode], '2026-09-19')?.id).toBe('jour');
    expect(pickDailyMenu([periode, jour], '2026-09-20')?.id).toBe('periode');
  });

  it("à égalité de type : le plus récemment modifié, puis l'identifiant (même résultat sur tous les nœuds)", () => {
    const a = menu('a', '2026-09-15', '2026-09-25', 100);
    const b = menu('b', '2026-09-16', '2026-09-30', 200);
    expect(pickDailyMenu([a, b], '2026-09-19')?.id).toBe('b');
    expect(pickDailyMenu([b, a], '2026-09-19')?.id).toBe('b');
    const c = menu('c', '2026-09-15', '2026-09-25', 100);
    expect(pickDailyMenu([a, c], '2026-09-19')?.id).toBe('c');
    expect(pickDailyMenu([c, a], '2026-09-19')?.id).toBe('c');
  });
});

describe('Menu du jour — saisie', () => {
  const id = '0192f3f8-7b6a-7000-8000-000000000001';
  it('au moins un plat, dates cohérentes', () => {
    expect(dailyMenuInputSchema.safeParse({ startDate: '2026-09-19', endDate: '2026-09-19', productIds: [id] }).success).toBe(true);
    expect(dailyMenuInputSchema.safeParse({ startDate: '2026-09-19', endDate: '2026-09-19', productIds: [] }).success).toBe(false);
    expect(dailyMenuInputSchema.safeParse({ startDate: '2026-09-20', endDate: '2026-09-19', productIds: [id] }).success).toBe(false);
    expect(dailyMenuInputSchema.safeParse({ startDate: '19/09/2026', endDate: '2026-09-19', productIds: [id] }).success).toBe(false);
  });
});
