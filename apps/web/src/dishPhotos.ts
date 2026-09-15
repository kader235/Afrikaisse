import { useCallback, useEffect, useState } from 'react';
import { dishPhotoFor, type DishPhotoSource } from '@afrikaisse/core/dish-photos';

/**
 * Photos d'exemple pour les plats sans photo, tirées du catalogue livré avec l'application.
 * Partagé par le menu client et l'application du personnel (sans Zod, pour le paquet du menu).
 * Adresse relative : servie par le même serveur que la page, et embarquée dans l'APK.
 * Une vraie photo n'est jamais remplacée : l'appelant n'utilise ceci que si `photoUrl` est vide.
 */
const CATALOGUE_URL = '/catalogue/catalogue.json';

let loaded: DishPhotoSource[] | null = null;
let loading: Promise<DishPhotoSource[]> | null = null;
const found = new Map<string, string | null>();

function loadDishes(): Promise<DishPhotoSource[]> {
  loading ??= fetch(CATALOGUE_URL)
    .then((r) => (r.ok ? (r.json() as Promise<{ dishes?: DishPhotoSource[] }>) : { dishes: [] }))
    .then((json) => (json.dishes ?? []).map((d) => ({ name: d.name, image: d.image ?? null })))
    .catch(() => [] as DishPhotoSource[])
    .then((dishes) => (loaded = dishes));
  return loading;
}

/** Fonction « nom du plat → photo d'exemple ou null », prête dès que le catalogue est chargé (une fois). */
export function useDishPhoto(enabled = true): (name: string) => string | null {
  const [dishes, setDishes] = useState<DishPhotoSource[] | null>(loaded);
  useEffect(() => {
    if (!enabled || dishes) return;
    let alive = true;
    void loadDishes().then((next) => alive && setDishes(next));
    return () => {
      alive = false;
    };
  }, [enabled, dishes]);
  return useCallback(
    (name: string) => {
      if (!enabled || !dishes || dishes.length === 0) return null;
      if (!found.has(name)) found.set(name, dishPhotoFor(name, dishes));
      return found.get(name) ?? null;
    },
    [enabled, dishes],
  );
}
