import type { CSSProperties } from 'react';
import { ZONE_COLORS, resolveZoneColor } from '@afrikaisse/core';

/**
 * Couleur de zone à l'écran : une pastille à côté du nom, un liseré en haut des tables.
 * Jamais de texte posé sur la couleur (écrans du personnel). Le plan gardé hors ligne
 * peut dater d'avant les couleurs : la teinte est alors déduite de l'ordre de la zone.
 */
export const ZONE_COLOR_NAMES: Record<(typeof ZONE_COLORS)[number], string> = {
  '#1D4ED8': 'Bleu',
  '#15803D': 'Vert',
  '#C2410C': 'Orange',
  '#7C3AED': 'Violet',
  '#0F766E': 'Turquoise',
  '#B91C1C': 'Rouge',
  '#B45309': 'Ambre',
  '#BE185D': 'Rose',
};

export function zoneColor(zone: { color?: string | null; sort: number } | null | undefined): string {
  return zone ? resolveZoneColor(zone.color, zone.sort) : 'transparent';
}

/** Variable CSS `--zone` lue par `.zone-dot`, `.zone-stripe`, `.zone-head` et `.swatch`. */
export function zoneVars(zone: { color?: string | null; sort: number } | null | undefined): CSSProperties {
  return { '--zone': zoneColor(zone) } as CSSProperties;
}

export function colorVars(color: string): CSSProperties {
  return { '--zone': color } as CSSProperties;
}
