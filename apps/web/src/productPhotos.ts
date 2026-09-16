import { useEffect, useState } from 'react';
import type { AdminMenu } from '@afrikaisse/core';
import { api } from './api.ts';
import { useDishPhoto } from './dishPhotos.ts';
import { readCache, saveCache } from './offline.ts';
import { mediaSrc } from './platform.ts';

/**
 * Vignette d'un plat sur une ligne de ticket, une carte de commande ou un ticket cuisine (design v3) :
 * la photo du plat si le gérant en a mis une, sinon la photo d'exemple du catalogue, sinon rien.
 * Le menu est lu une fois par établissement (et gardé hors ligne, comme pour la prise de commande).
 */
export function useProductPhotos(locationId: string | null, enabled = true): (productId: string | null, name: string) => string | null {
  const [index, setIndex] = useState<PhotoIndex>(() => fromMenu(locationId ? readCache<AdminMenu>(`menu.${locationId}`) : null));
  const sample = useDishPhoto(enabled);
  useEffect(() => {
    if (!enabled || !locationId) return;
    let alive = true;
    api<AdminMenu>('GET', `/locations/${locationId}/menu`).then(
      (menu) => {
        if (!alive) return;
        saveCache(`menu.${locationId}`, menu);
        setIndex(fromMenu(menu));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [locationId, enabled]);
  return (productId, name) => {
    if (!enabled) return null;
    const own = (productId ? index.byId.get(productId) : null) ?? index.byName.get(name.trim().toLocaleLowerCase('fr')) ?? null;
    return own ? mediaSrc(own) : sample(name);
  };
}

interface PhotoIndex {
  byId: Map<string, string | null>;
  /** Les rapports ne donnent que le nom du plat. */
  byName: Map<string, string | null>;
}

function fromMenu(menu: AdminMenu | null): PhotoIndex {
  const products = menu?.products ?? [];
  return { byId: new Map(products.map((p) => [p.id, p.photoUrl])), byName: new Map(products.map((p) => [p.name.trim().toLocaleLowerCase('fr'), p.photoUrl])) };
}

/** Initiales d'un nom (« Achta Démo » → « AD »). */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

/** « Bonjour » avant 18 h, « Bonsoir » après ; le prénom seul. */
export function greeting(displayName: string, now = new Date()): string {
  const first = displayName.trim().split(/\s+/)[0] ?? '';
  return `${now.getHours() < 18 ? 'Bonjour' : 'Bonsoir'}${first ? ` ${first}` : ''}`;
}

/** « Mardi 16 septembre · Service du soir ». */
export function serviceLine(now = new Date()): string {
  const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = now.getHours();
  const service = h < 11 ? 'Matin' : h < 16 ? 'Service du midi' : 'Service du soir';
  return `${date.charAt(0).toUpperCase() + date.slice(1)} · ${service}`;
}
