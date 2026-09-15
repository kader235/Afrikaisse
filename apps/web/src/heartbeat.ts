import { useEffect } from 'react';
import { uuidv7 } from '@afrikaisse/core';
import { api } from './api.ts';

/**
 * Signe de vie d'un écran cuisine (§68) : l'écran ouvert se signale toutes les 30 s, et la
 * supervision sait quels écrans sont allumés. Identifiant tiré une fois et gardé sur l'appareil.
 */
const KEY = 'afk.kds.screen';
let memo: string | null = null;

function screenId(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored)) return stored;
    const id = uuidv7();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    if (!memo) memo = uuidv7();
    return memo;
  }
}

export function useScreenHeartbeat(locationId: string | null, stationId: string | null) {
  useEffect(() => {
    if (!locationId) return;
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      api('POST', `/locations/${locationId}/screens/heartbeat`, { screenId: screenId(), stationId }).catch(() => undefined);
    };
    beat();
    const id = window.setInterval(beat, 30_000);
    return () => window.clearInterval(id);
  }, [locationId, stationId]);
}
