import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_ORDER_STATUSES, type Activity, type Order, type ServiceRequest } from '@afrikaisse/core';
import { api } from './api.ts';
import { beep, unlockSound } from './sound.ts';

export interface ActivityFeed {
  orders: Order[];
  requests: ServiceRequest[];
  /** Commandes terminées ou annulées depuis l'ouverture de l'écran (pour libérer les tables). */
  closed: Order[];
  online: boolean;
  loaded: boolean;
  refresh: () => void;
  applyOrder: (order: Order) => void;
  applyRequest: (request: ServiceRequest) => void;
}

const FAST_MS = 3000;
const HIDDEN_MS = 15000;
const OFFLINE_MS = 6000;

/**
 * Flux d'activité d'un établissement, interrogé régulièrement (3 s à l'écran, 15 s en
 * arrière-plan). Un seul flux pour toute l'application : la pastille de l'onglet
 * Commandes et le signal sonore marchent quel que soit l'écran ouvert.
 */
export function useActivityFeed(locationId: string | null, enabled: boolean, alertStaff = true): ActivityFeed {
  const [orders, setOrders] = useState<Map<string, Order>>(new Map());
  const [requests, setRequests] = useState<Map<string, ServiceRequest>>(new Map());
  const [closed, setClosed] = useState<Order[]>([]);
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const cursor = useRef(0);
  const known = useRef<Set<string>>(new Set());
  const wake = useRef<() => void>(() => undefined);
  const alertRef = useRef(alertStaff);
  alertRef.current = alertStaff;

  useEffect(() => {
    const unlock = () => unlockSound();
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const merge = useCallback((activity: Activity) => {
    let alert = false;
    setOrders((current) => {
      const next = activity.full ? new Map<string, Order>() : new Map(current);
      for (const order of activity.orders) {
        if (ACTIVE_ORDER_STATUSES.includes(order.status)) next.set(order.id, order);
        else {
          next.delete(order.id);
          setClosed((list) => [order, ...list.filter((o) => o.id !== order.id)].slice(0, 30));
        }
        const key = `order:${order.id}`;
        if (order.status === 'PENDING' && !known.current.has(key)) {
          if (cursor.current > 0) alert = true;
          known.current.add(key);
        }
      }
      return next;
    });
    setRequests((current) => {
      const next = activity.full ? new Map<string, ServiceRequest>() : new Map(current);
      for (const request of activity.requests) {
        if (request.status === 'OPEN') next.set(request.id, request);
        else next.delete(request.id);
        const key = `request:${request.id}`;
        if (request.status === 'OPEN' && !known.current.has(key)) {
          if (cursor.current > 0) alert = true;
          known.current.add(key);
        }
      }
      return next;
    });
    if (alert && alertRef.current) beep(3);
  }, []);

  useEffect(() => {
    if (!enabled || !locationId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    cursor.current = 0;
    known.current = new Set();
    setLoaded(false);

    const tick = async () => {
      clearTimeout(timer);
      let delay = document.hidden ? HIDDEN_MS : FAST_MS;
      try {
        const activity = await api<Activity>('GET', `/locations/${locationId}/activity?since=${cursor.current}`);
        if (stopped) return;
        merge(activity);
        cursor.current = activity.cursor;
        setOnline(true);
        setLoaded(true);
      } catch {
        if (stopped) return;
        setOnline(false);
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
  }, [enabled, locationId, merge]);

  const applyOrder = useCallback((order: Order) => merge({ cursor: cursor.current, full: false, orders: [order], requests: [] }), [merge]);
  const applyRequest = useCallback((request: ServiceRequest) => merge({ cursor: cursor.current, full: false, orders: [], requests: [request] }), [merge]);

  return {
    orders: [...orders.values()],
    requests: [...requests.values()],
    closed,
    online,
    loaded,
    refresh: () => wake.current(),
    applyOrder,
    applyRequest,
  };
}
