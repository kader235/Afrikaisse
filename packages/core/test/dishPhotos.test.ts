import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dishPhotoFor, type DishPhotoSource } from '../src/dishPhotos.ts';

const catalogue = JSON.parse(readFileSync(new URL('../../../apps/web/public/catalogue/catalogue.json', import.meta.url), 'utf8')) as { dishes: DishPhotoSource[] };
const dishes = catalogue.dishes;
const photo = (name: string) => dishPhotoFor(name, dishes);

describe("Photos d'exemple des plats sans photo", () => {
  it('trouve le plat du catalogue malgré l’ordre des mots, les accents et les quantités', () => {
    expect(photo('Poulet yassa')).toBe('/catalogue/images/yassa-poulet.webp');
    expect(photo('Demi-poulet braisé')).toBe('/catalogue/images/poulet-braise.webp');
    expect(photo('Classic Burger')).toBe('/catalogue/images/burger.webp');
    expect(photo('Soda 33 cl')).toBe('/catalogue/images/soda.webp');
    expect(photo('Eau minérale 1,5 l')).toBe('/catalogue/images/eau-minerale.webp');
    expect(photo('Riz gras')).toBe('/catalogue/images/riz-gras.webp');
  });

  it('accepte l’une des photos possibles quand deux plats du catalogue conviennent', () => {
    expect(['/catalogue/images/capitaine-braise.webp', '/catalogue/images/poisson-braise-baton.webp']).toContain(photo('Poisson braisé'));
    expect(['/catalogue/images/kissar.webp', '/catalogue/images/sauce-gombo.webp']).toContain(photo('Kissar sauce gombo'));
  });

  it('lit le contenu des parenthèses comme un autre nom', () => {
    expect(photo('Poisson braisé (capitaine)')).toBe('/catalogue/images/capitaine-braise.webp');
    expect(photo('Brochettes (tchitchinga)')).toBe('/catalogue/images/tchitchinga.webp');
  });

  it('ne met pas la photo d’un autre plat sur un mot trop général', () => {
    expect(photo('Jus de bissap')).toBeNull();
    expect(photo('Jus de gingembre')).toBeNull();
    expect(photo('Salade avocat-crevettes')).toBeNull();
    expect(photo('Sauce kanda')).toBeNull();
    expect(photo('Tacos')).toBeNull();
    expect(photo('Soupe de poisson')).toBeNull();
  });

  it('ignore les plats du catalogue sans image et les noms vides', () => {
    expect(dishPhotoFor('Daraba', dishes)).toBeNull();
    expect(dishPhotoFor('(4)', dishes)).toBeNull();
    expect(dishPhotoFor('Burger', [])).toBeNull();
  });
});
