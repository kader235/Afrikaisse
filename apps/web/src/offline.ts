import { useEffect, useState } from 'react';
import { ApiError, OFFLINE, api } from './api.ts';

/**
 * Hors ligne sur la tablette (coupure de courant ou d'Internet) :
 * - le dernier menu, le plan de salle et les prix restent sur l'appareil ;
 * - une commande qui ne part pas est gardée dans une file d'envoi et part seule au retour de la connexion.
 * Chaque commande porte son identifiant (UUID v7, créé ici) : renvoyée deux fois, le serveur ne l'enregistre qu'une fois.
 */

const CACHE = 'afk.cache.';
const OUTBOX = 'afk.outbox';

export function saveCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(CACHE + key, JSON.stringify(value));
  } catch {
    /* stockage plein ou indisponible : on garde l'écran en mémoire seulement */
  }
}

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** À la déconnexion : rien du compte ne reste sur la tablette (la file d'envoi, elle, est gardée). */
export function clearCache(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE)) localStorage.removeItem(key);
  } catch {
    /* stockage indisponible */
  }
}

export const isOffline = (err: unknown): boolean => err instanceof ApiError && err.code === OFFLINE;

export interface QueuedOrder {
  id: string;
  locationId: string;
  tableLabel: string;
  tableId: string | null;
  body: Record<string, unknown>;
  createdAt: number;
  /** Refus du serveur au renvoi (plat supprimé entre-temps…) : la commande reste affichée pour être reprise. */
  error: string | null;
}

const listeners = new Set<() => void>();

function readOutbox(): QueuedOrder[] {
  try {
    const raw = localStorage.getItem(OUTBOX);
    return raw ? (JSON.parse(raw) as QueuedOrder[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(list: QueuedOrder[]): void {
  try {
    localStorage.setItem(OUTBOX, JSON.stringify(list));
  } catch {
    /* stockage indisponible : la file vit jusqu'à la fermeture de l'application */
  }
  for (const listener of listeners) listener();
}

export function queueOrder(entry: Omit<QueuedOrder, 'createdAt' | 'error'>): void {
  writeOutbox([...readOutbox(), { ...entry, createdAt: Date.now(), error: null }]);
}

export function dropQueuedOrder(id: string): void {
  writeOutbox(readOutbox().filter((o) => o.id !== id));
}

/** Une commande destinée à un autre serveur ne doit jamais être rejouée ici. */
export function clearOutbox(): void {
  writeOutbox([]);
}

let flushing: Promise<number> | null = null;

/** Envoie la file dans l'ordre de prise ; s'arrête à la première coupure. Renvoie le nombre de commandes parties. */
export function flushOutbox(): Promise<number> {
  if (!flushing) {
    flushing = (async () => {
      let sent = 0;
      for (const entry of readOutbox()) {
        if (entry.error) continue;
        try {
          await api('POST', `/locations/${entry.locationId}/orders`, { ...entry.body, id: entry.id });
          dropQueuedOrder(entry.id);
          sent += 1;
        } catch (err) {
          // Coupure, session à renouveler, serveur qui redémarre : on réessaiera, rien n'est perdu.
          if (isOffline(err) || !(err instanceof ApiError) || err.status === 401 || err.status === 429 || err.status >= 500) break;
          writeOutbox(readOutbox().map((o) => (o.id === entry.id ? { ...o, error: err.message } : o)));
        }
      }
      return sent;
    })().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

/** Une seule boucle d'envoi pour toute l'application : toutes les 10 s et dès que le réseau revient. */
export function useOutboxSender(onSent?: (count: number) => void): void {
  useEffect(() => {
    const tick = () => {
      if (readOutbox().some((o) => !o.error)) void flushOutbox().then((n) => n > 0 && onSent?.(n));
    };
    tick();
    const id = setInterval(tick, 10_000);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', tick);
    };
  }, []);
}

/** Commandes en attente d'envoi, relues à chaque changement de la file. */
export function useQueuedOrders(): QueuedOrder[] {
  const [list, setList] = useState(readOutbox);
  useEffect(() => {
    const update = () => setList(readOutbox());
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return list;
}
