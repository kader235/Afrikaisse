import { describe, expect, it } from 'vitest';
import { ACTIVE_ORDER_STATUSES, businessDate, canTransition, nextStatuses, placeQrOrderSchema } from '../src/index.ts';

describe('Cycle de vie d’une commande', () => {
  it('suit l’ordre du service et ne revient jamais en arrière', () => {
    expect(canTransition('PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'PREPARING')).toBe(true);
    expect(canTransition('PREPARING', 'READY')).toBe(true);
    expect(canTransition('READY', 'SERVED')).toBe(true);
    expect(canTransition('SERVED', 'COMPLETED')).toBe(true);
    expect(canTransition('READY', 'PREPARING')).toBe(false);
    expect(canTransition('SERVED', 'CANCELLED')).toBe(false);
    expect(nextStatuses('COMPLETED')).toEqual([]);
    expect(nextStatuses('CANCELLED')).toEqual([]);
    expect(ACTIVE_ORDER_STATUSES).not.toContain('COMPLETED');
  });
});

describe('Journée d’exploitation', () => {
  const at = (iso: string) => Date.parse(iso);

  it('compte le service de nuit pour la veille, dans le fuseau de l’établissement', () => {
    // N'Djamena = UTC+1. 01:30 locale le 15, bascule à 05:00 → journée du 14.
    expect(businessDate(at('2026-09-15T00:30:00Z'), 'Africa/Ndjamena', 300)).toBe('2026-09-14');
    // 05:30 locale le 15 → journée du 15.
    expect(businessDate(at('2026-09-15T04:30:00Z'), 'Africa/Ndjamena', 300)).toBe('2026-09-15');
    // Même instant, bascule à minuit → journée du 15.
    expect(businessDate(at('2026-09-15T00:30:00Z'), 'Africa/Ndjamena', 0)).toBe('2026-09-15');
    // Le fuseau compte : 23:30 UTC le 14 = 23:30 à Dakar (UTC) mais 00:30 le 15 à N'Djamena.
    expect(businessDate(at('2026-09-14T23:30:00Z'), 'Africa/Dakar', 0)).toBe('2026-09-14');
    expect(businessDate(at('2026-09-14T23:30:00Z'), 'Africa/Ndjamena', 0)).toBe('2026-09-15');
  });
});

describe('Commande par QR', () => {
  it('exige un panier non vide et un identifiant de client valable', () => {
    const line = { productId: '01a09d64-3a6a-7204-abc7-731bc3ab1df2', quantity: 1 };
    expect(placeQrOrderSchema.safeParse({ clientToken: 'abcdefghijklmnop', lines: [line] }).success).toBe(true);
    expect(placeQrOrderSchema.safeParse({ clientToken: 'abcdefghijklmnop', lines: [] }).success).toBe(false);
    expect(placeQrOrderSchema.safeParse({ clientToken: 'court', lines: [line] }).success).toBe(false);
    expect(placeQrOrderSchema.safeParse({ clientToken: 'abcdefghijklmnop', lines: [{ ...line, quantity: 100 }] }).success).toBe(false);
  });
});
