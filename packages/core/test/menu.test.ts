import { describe, expect, it } from 'vitest';
import {
  createModifierGroupSchema,
  createProductSchema,
  formatMoney,
  generateToken,
  moneyToInput,
  parseMoney,
  priceLine,
  roleCan,
  type PricingProduct,
} from '../src/index.ts';

const spaces = (s: string) => s.replace(/[  ]/g, ' ');

describe('Argent', () => {
  it('formate le FCFA sans décimales et l’euro avec deux', () => {
    expect(spaces(formatMoney(5500, 'XAF'))).toBe('5 500 FCFA');
    expect(spaces(formatMoney(1250, 'EUR'))).toBe('12,50 €');
  });

  it('lit les montants saisis au clavier', () => {
    expect(parseMoney('5 500', 'XAF')).toBe(5500);
    expect(parseMoney('5500 FCFA', 'XAF')).toBe(5500);
    expect(parseMoney('12,5', 'EUR')).toBe(1250);
    expect(parseMoney('12.50 €', 'EUR')).toBe(1250);
    expect(parseMoney('12,505', 'EUR')).toBeNull();
    expect(parseMoney('55,5', 'XAF')).toBeNull();
    expect(parseMoney('abc', 'XAF')).toBeNull();
    expect(moneyToInput(1250, 'EUR')).toBe('12,50');
    expect(moneyToInput(5500, 'XAF')).toBe('5500');
  });
});

describe('Jeton de QR', () => {
  it('produit des jetons base64url de 22 caractères, tous différents', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

const burger: PricingProduct = {
  id: 'p1',
  name: 'Burger',
  price: 5000,
  promoPrice: null,
  isAvailable: true,
  variants: [
    { id: 'v-simple', name: 'Simple', priceDelta: 0, isAvailable: true },
    { id: 'v-double', name: 'Double', priceDelta: 1500, isAvailable: true },
  ],
  modifierGroups: [
    {
      id: 'g-cuisson',
      name: 'Cuisson',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: 'm-saignant', name: 'Saignant', priceDelta: 0, isAvailable: true },
        { id: 'm-apoint', name: 'À point', priceDelta: 0, isAvailable: true },
      ],
    },
    {
      id: 'g-sup',
      name: 'Suppléments',
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { id: 'm-fromage', name: 'Fromage', priceDelta: 500, isAvailable: true },
        { id: 'm-bacon', name: 'Bacon', priceDelta: 1000, isAvailable: false },
        { id: 'm-oeuf', name: 'Œuf', priceDelta: 300, isAvailable: true },
      ],
    },
  ],
};

describe('Prix d’une ligne', () => {
  it('additionne variante et options, multiplie par la quantité', () => {
    const line = priceLine(burger, { variantId: 'v-double', modifierIds: ['m-apoint', 'm-fromage', 'm-oeuf'], quantity: 2 });
    expect(line).toMatchObject({ ok: true, unitPrice: 5000 + 1500 + 500 + 300, total: 14600 });
  });

  it('utilise le prix promotionnel', () => {
    const line = priceLine({ ...burger, promoPrice: 4000 }, { variantId: 'v-simple', modifierIds: ['m-saignant'], quantity: 1 });
    expect(line).toMatchObject({ ok: true, unitPrice: 4000 });
  });

  it('refuse les sélections que le restaurant n’a pas prévues', () => {
    const code = (sel: Parameters<typeof priceLine>[1], product = burger) => {
      const r = priceLine(product, sel);
      return r.ok ? 'OK' : r.code;
    };
    expect(code({ modifierIds: ['m-saignant'], quantity: 1 })).toBe('VARIANT_REQUIRED');
    expect(code({ variantId: 'autre', modifierIds: ['m-saignant'], quantity: 1 })).toBe('VARIANT_INVALID');
    expect(code({ variantId: 'v-simple', modifierIds: [], quantity: 1 })).toBe('GROUP_MIN');
    expect(code({ variantId: 'v-simple', modifierIds: ['m-saignant', 'm-apoint'], quantity: 1 })).toBe('GROUP_MAX');
    expect(code({ variantId: 'v-simple', modifierIds: ['m-saignant', 'm-bacon'], quantity: 1 })).toBe('MODIFIER_UNAVAILABLE');
    expect(code({ variantId: 'v-simple', modifierIds: ['m-saignant', 'intrus'], quantity: 1 })).toBe('MODIFIER_INVALID');
    expect(code({ variantId: 'v-simple', modifierIds: ['m-saignant', 'm-saignant'], quantity: 1 })).toBe('MODIFIER_INVALID');
    expect(code({ variantId: 'v-simple', modifierIds: ['m-saignant'], quantity: 0 })).toBe('QUANTITY_INVALID');
    expect(code({ variantId: 'v-simple', modifierIds: ['m-saignant'], quantity: 1 }, { ...burger, isAvailable: false })).toBe('PRODUCT_UNAVAILABLE');
    expect(code({ variantId: 'v-simple', quantity: 1 }, { ...burger, modifierGroups: [] })).toBe('OK');
  });
});

describe('Contrats du menu', () => {
  it('refuse un prix promotionnel supérieur au prix et un groupe incohérent', () => {
    expect(createProductSchema.safeParse({ name: 'Jus', price: 1000, promoPrice: 1200 }).success).toBe(false);
    expect(createProductSchema.safeParse({ name: 'Jus', price: 1000, promoPrice: 800 }).success).toBe(true);
    const modifiers = [{ name: 'A' }, { name: 'B' }];
    expect(createModifierGroupSchema.safeParse({ name: 'Sauces', minSelect: 2, maxSelect: 1, modifiers }).success).toBe(false);
    expect(createModifierGroupSchema.safeParse({ name: 'Sauces', minSelect: 0, maxSelect: 3, modifiers }).success).toBe(false);
    expect(createModifierGroupSchema.safeParse({ name: 'Sauces', minSelect: 0, maxSelect: 2, modifiers }).success).toBe(true);
  });

  it('la cuisine et le bar peuvent marquer un produit épuisé, pas le modifier', () => {
    expect(roleCan('KITCHEN', 'menu.availability')).toBe(true);
    expect(roleCan('KITCHEN', 'menu.manage')).toBe(false);
    expect(roleCan('WAITER', 'menu.availability')).toBe(false);
  });
});
