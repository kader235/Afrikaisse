import { describe, expect, it } from 'vitest';
import { allocatePayment, cashSuggestions, discountAmount, discountSchema, paymentStatusOf, recordPaymentSchema, splitEvenly } from '../src/index.ts';

describe('caisse — calculs', () => {
  it('remise : pourcentage arrondi vers le bas, jamais au-delà du sous-total', () => {
    expect(discountAmount(6500, 'PERCENT', 10)).toBe(650);
    expect(discountAmount(999, 'PERCENT', 15)).toBe(149);
    expect(discountAmount(6500, 'AMOUNT', 10000)).toBe(6500);
    expect(discountAmount(6500, 'PERCENT', 0)).toBe(0);
  });

  it('état de paiement', () => {
    expect(paymentStatusOf(1000, 0)).toBe('UNPAID');
    expect(paymentStatusOf(1000, 400)).toBe('PARTIAL');
    expect(paymentStatusOf(1000, 1000)).toBe('PAID');
    expect(paymentStatusOf(0, 0)).toBe('PAID');
  });

  it('addition partagée : parts égales, le reste sur les premières, total conservé', () => {
    expect(splitEvenly(9500, 2)).toEqual([4750, 4750]);
    expect(splitEvenly(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEvenly(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('répartition d’un paiement : la commande la plus ancienne d’abord', () => {
    const dues = [
      { id: 'a', remaining: 3000 },
      { id: 'b', remaining: 6500 },
    ];
    expect(allocatePayment(4750, dues)).toEqual([
      { id: 'a', amount: 3000 },
      { id: 'b', amount: 1750 },
    ]);
    expect(allocatePayment(2000, dues)).toEqual([{ id: 'a', amount: 2000 }]);
  });

  it('espèces : montant exact puis coupures rondes', () => {
    expect(cashSuggestions(8500)).toEqual([8500, 9000, 10000]);
    expect(cashSuggestions(12300)).toEqual([12300, 12500, 13000, 14000, 15000]);
  });

  it('entrées : motif de remise exigé, somme remise suffisante', () => {
    expect(discountSchema.safeParse({ kind: 'PERCENT', value: 10 }).success).toBe(false);
    expect(discountSchema.safeParse({ kind: 'AMOUNT', value: 0 }).success).toBe(true);
    const target = { kind: 'order', id: '0190b1a2-0000-7000-8000-000000000000' };
    expect(recordPaymentSchema.safeParse({ target, method: 'CASH', amount: 1000, tendered: 500 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ target, method: 'CASH', amount: 1000, tendered: 2000 }).success).toBe(true);
  });
});
