import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppNotification, NotificationFeed } from '@afrikaisse/core';
import { api } from './api.ts';

export interface NotificationCenter {
  items: AppNotification[];
  unread: number;
  loaded: boolean;
  markRead: (notification: AppNotification) => void;
  markAll: () => void;
  refresh: () => void;
}

const FAST_MS = 5000;
const HIDDEN_MS = 20000;
const OFFLINE_MS = 10000;
const KEEP = 100;

/**
 * Centre de notifications d'un établissement, interrogé régulièrement (`since=`), sans WebSocket.
 * Aucun son ici : alerts.tsx signale chaque événement une seule fois, selon le rôle.
 */
export function useNotifications(locationId: string | null, enabled: boolean): NotificationCenter {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const cursor = useRef(0);
  const wake = useRef<() => void>(() => undefined);

  useEffect(() => {
    setItems([]);
    setUnread(0);
    setLoaded(false);
    cursor.current = 0;
    if (!enabled || !locationId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      clearTimeout(timer);
      let delay = document.hidden ? HIDDEN_MS : FAST_MS;
      try {
        const feed = await api<NotificationFeed>('GET', `/locations/${locationId}/notifications?since=${cursor.current}`);
        if (stopped) return;
        setItems((current) => {
          if (feed.full) return feed.items;
          const fresh = new Set(feed.items.map((n) => n.id));
          return [...feed.items, ...current.filter((n) => !fresh.has(n.id))].slice(0, KEEP);
        });
        setUnread(feed.unread);
        cursor.current = feed.cursor;
        setLoaded(true);
      } catch {
        if (stopped) return;
        delay = OFFLINE_MS;
      }
      if (!stopped) timer = setTimeout(tick, delay);
    };
    wake.current = () => void tick();
    void tick();
    const onVisible = () => !document.hidden && void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, locationId]);

  const markRead = useCallback((notification: AppNotification) => {
    if (notification.read) return;
    setItems((list) => list.map((n) => (n.id === notification.id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    api('POST', `/notifications/${notification.id}/read`).catch(() => wake.current());
  }, []);

  const markAll = useCallback(() => {
    if (!locationId) return;
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setUnread(0);
    api<{ unread: number }>('POST', `/locations/${locationId}/notifications/read-all`, { upTo: cursor.current }).then(
      (res) => setUnread(res.unread),
      () => wake.current(),
    );
  }, [locationId]);

  return { items, unread, loaded, markRead, markAll, refresh: () => wake.current() };
}
