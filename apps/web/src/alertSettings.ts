import { useEffect, useState } from 'react';
import type { AlertVolume } from './chime.ts';
import { isNativeApp } from './platform.ts';

/** Réglages « Son et notifications », propres à l'appareil (localStorage). */
export interface AlertSettings {
  volume: AlertVolume;
  /** Notification Android (tablette) ou du système (navigateur, si autorisée). */
  system: boolean;
  /** Garder l'écran allumé tant que l'application est ouverte. */
  keepAwake: boolean;
}

const KEY = 'afk.alerts';
const listeners = new Set<(s: AlertSettings) => void>();

function defaults(): AlertSettings {
  const native = isNativeApp();
  return { volume: 'high', system: native, keepAwake: native };
}

export function readAlertSettings(): AlertSettings {
  const base = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AlertSettings>;
    return {
      volume: raw.volume === 'low' || raw.volume === 'medium' || raw.volume === 'high' ? raw.volume : base.volume,
      system: typeof raw.system === 'boolean' ? raw.system : base.system,
      keepAwake: typeof raw.keepAwake === 'boolean' ? raw.keepAwake : base.keepAwake,
    };
  } catch {
    return base;
  }
}

export function saveAlertSettings(patch: Partial<AlertSettings>): AlertSettings {
  const next = { ...readAlertSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* réglage valable jusqu'au prochain démarrage */
  }
  listeners.forEach((cb) => cb(next));
  return next;
}

export function useAlertSettings(): [AlertSettings, (patch: Partial<AlertSettings>) => void] {
  const [settings, setSettings] = useState(readAlertSettings);
  useEffect(() => {
    listeners.add(setSettings);
    return () => {
      listeners.delete(setSettings);
    };
  }, []);
  return [settings, saveAlertSettings];
}
