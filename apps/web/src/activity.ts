import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_ORDER_STATUSES, type Activity, type Order, type ServiceRequest } from '@afrikaisse/core';
import { api } from './api.ts';

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
const RECHECK_MS = 1500;
/** Échecs de suite avant d'afficher « Hors ligne » : un raté isolé (micro-coupure, redémarrage bref) n'en est pas une. */
const OFFLINE_AFTER = 3;

/**
 * Flux d'activité d'un établissement, interrogé régulièrement (3 s à l'écran, 15 s en
 * arrière-plan). Un seul flux pour toute l'application : la pastille de l'onglet
 * Commandes et les alertes du personnel (alerts.tsx) marchent quel que soit l'écran ouvert.
 */
export function useActivityFeed(locationId: string | null, enabled: boolean): ActivityFeed {
  const [orders, setOrders] = useState<Map<string, Order>>(new Map());
  const [requests, setRequests] = useState<Map<string, ServiceRequest>>(new Map());
  const [closed, setClosed] = useState<Order[]>([]);
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const cursor = useRef(0);
  const wake = useRef<() => void>(() => undefined);

  const merge = useCallback((activity: Activity) => {
    setOrders((current) => {
      const next = activity.full ? new Map<string, Order>() : new Map(current);
      for (const order of activity.orders) {
        if (ACTIVE_ORDER_STATUSES.includes(order.status)) next.set(order.id, order);
        else {
          next.delete(order.id);
          setClosed((list) => [order, ...list.filter((o) => o.id !== order.id)].slice(0, 30));
        }
      }
      return next;
    });
    setRequests((current) => {
      const next = activity.full ? new Map<string, ServiceRequest>() : new Map(current);
      for (const request of activity.requests) {
        if (request.status === 'OPEN') next.set(request.id, request);
        else next.delete(request.id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled || !locationId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    cursor.current = 0;
    let failures = 0;
    setLoaded(false);

    const tick = async () => {
      clearTimeout(timer);
      let delay = document.hidden ? HIDDEN_MS : FAST_MS;
      try {
        const activity = await api<Activity>('GET', `/locations/${locationId}/activity?since=${cursor.current}`);
        if (stopped) return;
        merge(activity);
        cursor.current = activity.cursor;
        failures = 0;
        setOnline(true);
        setLoaded(true);
      } catch {
        if (stopped) return;
        failures += 1;
        if (failures >= OFFLINE_AFTER) setOnline(false);
        delay = failures >= OFFLINE_AFTER ? OFFLINE_MS : RECHECK_MS;
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
