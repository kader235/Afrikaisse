import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_CATEGORIES, catalogueSchema, cataloguePrice, dishesForCountry, type Catalogue } from '../src/index.ts';

const DIR = join(import.meta.dirname, '../../../apps/web/public/catalogue');

describe('Catalogue de plats', () => {
  it('convertit le prix indicatif dans la devise de l’établissement, arrondi à un montant rond', () => {
    expect(cataloguePrice(2500, 'XAF')).toBe(2500);
    expect(cataloguePrice(2520, 'XOF')).toBe(2500);
    expect(cataloguePrice(10, 'XAF')).toBe(50);
    // 3 000 FCFA ≈ 4,57 € → 4,50 €, en centimes.
    expect(cataloguePrice(3000, 'EUR')).toBe(450);
    // Naira : 2 500 FCFA × 2,5 = 6 250 ₦ → 6 250,00 en kobo.
    expect(cataloguePrice(2500, 'NGN')).toBe(625000);
    expect(cataloguePrice(2500, 'GNF') % 500).toBe(0);
  });

  it('recommande les plats du pays et ceux vendus partout', () => {
    const catalogue: Catalogue = {
      version: 1,
      baseCurrency: 'XAF',
      groups: [{ id: 'tchad', label: 'Tchad' }],
      dishes: [
        { id: 'daraba', name: 'Daraba', description: null, category: 'Plats', group: 'tchad', countries: ['TD'], priceXaf: 2500, image: null, credit: null },
        { id: 'burger', name: 'Burger', description: null, category: 'Fast-food', group: 'monde', countries: ['*'], priceXaf: 3500, image: null, credit: null },
        { id: 'ndole', name: 'Ndolé', description: null, category: 'Plats', group: 'afrique-centrale', countries: ['CM'], priceXaf: 3000, image: null, credit: null },
      ],
    };
    expect(dishesForCountry(catalogue, 'TD').map((d) => d.id)).toEqual(['daraba', 'burger']);
    expect(dishesForCountry(catalogue, 'CM').map((d) => d.id)).toEqual(['burger', 'ndole']);
  });

  it('le catalogue livré est valide : ids uniques, catégories connues, chaque photo présente et créditée', () => {
    const file = join(DIR, 'catalogue.json');
    expect(existsSync(file)).toBe(true);
    const catalogue = catalogueSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const ids = catalogue.dishes.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(catalogue.groups.map((g) => g.id));
    for (const dish of catalogue.dishes) {
      expect(CATALOGUE_CATEGORIES).toContain(dish.category);
      expect(groups.has(dish.group)).toBe(true);
      expect(dish.priceXaf % 50).toBe(0);
      if (dish.image) {
        expect(existsSync(join(DIR, 'images', dish.image))).toBe(true);
        expect(dish.credit).not.toBeNull();
      }
    }
    expect(dishesForCountry(catalogue, 'TD').length).toBeGreaterThan(0);
  });
});
