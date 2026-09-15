import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { stationPermission, type Me, type Station } from '@afrikaisse/core';
import type { ActivityFeed } from './activity.ts';
import type { NotificationCenter } from './notifications.ts';
import { api } from './api.ts';
import {
  activeAlerts,
  alertProfile,
  chimeFor,
  groupAlerts,
  newAlertMemory,
  notificationId,
  profileSignature,
  reminderChime,
  stepAlerts,
  type Alert,
  type AlertTarget,
} from './alertRules.ts';
import { readAlertSettings, useAlertSettings } from './alertSettings.ts';
import { installSoundUnlock, playChime } from './sound.ts';
import { cancelSystemNotification, postSystemNotification, prepareSystemNotifications, setSystemTapHandler } from './systemNotify.ts';
import { useWakeLock } from './wakeLock.ts';
import { KDS_STATION_EVENT } from './pages/Kitchen.tsx';
import { Icon } from './ui.tsx';
import './styles/alerts.css';

/**
 * Alertes du personnel, pour tout l'écran : un son par événement selon le rôle (alertRules.ts),
 * notification Android quand l'application est en arrière-plan, carte visible qui disparaît
 * quand l'événement est traité (commande confirmée, ticket lancé, commande servie, appel traité).
 */

const REMINDER_MS = 30_000;
/** Une notification toute neuve peut précéder la commande dans le flux : on laisse 20 s au flux pour la voir. */
const SETTLE_MS = 20_000;
const KDS_STATION_KEY = 'afk.kds.station';

export interface StaffAlerts {
  /** Alertes signalées pendant cette session et pas encore traitées, une par groupe. */
  cards: Alert[];
  dismiss: (group: string) => void;
}

function readStation(): string {
  try {
    return localStorage.getItem(KDS_STATION_KEY) ?? '';
  } catch {
    return '';
  }
}

const sameKeys = (a: readonly Alert[], b: readonly Alert[]) => a.length === b.length && a.every((x, i) => x.key === b[i]!.key && x.title === b[i]!.title);

export function useStaffAlerts({
  me,
  feed,
  notifications,
  onKitchenScreen,
  onOpen,
}: {
  me: Me;
  feed: ActivityFeed;
  notifications: NotificationCenter;
  onKitchenScreen: boolean;
  onOpen: (target: AlertTarget) => void;
}): StaffAlerts {
  const [settings] = useAlertSettings();
  const locationId = me.locations[0]?.id ?? null;
  const perms = me.permissions;
  const cook = perms.includes('kitchen.use') || perms.includes('bar.use');
  const concerned = me.tenantAccess === 'OK' && (cook || perms.includes('orders.create') || perms.includes('payments.collect'));
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  const [stations, setStations] = useState<Station[] | null>(null);
  const [station, setStation] = useState(readStation);
  const memory = useRef(newAlertMemory());
  const posted = useRef(new Map<string, number>());
  const [active, setActive] = useState<Alert[]>([]);
  const [signaled, setSignaled] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useWakeLock(concerned && settings.keepAwake);

  useEffect(() => {
    if (!concerned) return;
    installSoundUnlock();
    setSystemTapHandler((target) => openRef.current(target === 'kitchen' ? 'kitchen' : 'orders'));
    void prepareSystemNotifications(readAlertSettings().system);
  }, [concerned]);

  useEffect(() => {
    if (!cook || !locationId || me.tenantAccess !== 'OK') return;
    api<Station[]>('GET', `/locations/${locationId}/stations`).then(setStations, () => undefined);
  }, [cook, locationId, me.tenantAccess]);

  useEffect(() => {
    const onChange = () => setStation(readStation());
    window.addEventListener(KDS_STATION_EVENT, onChange);
    return () => window.removeEventListener(KDS_STATION_EVENT, onChange);
  }, []);

  const allowed = stations ? stations.filter((s) => perms.includes(stationPermission(s.kind))).map((s) => s.id) : null;
  const stationId = station && (allowed === null || allowed.includes(station)) ? station : null;
  const profile = alertProfile(me.user, perms, { onKitchenScreen, kitchenScope: { stationId, allowedStationIds: allowed } });
  const signature = profileSignature(profile);

  useEffect(() => {
    if (!concerned) return;
    const list = activeAlerts({ orders: feed.orders, requests: feed.requests, notifications: notifications.items }, profile);
    const step = stepAlerts(memory.current, list, signature, { feed: feed.loaded, notifications: notifications.loaded });
    setActive((prev) => (sameKeys(prev, list) ? prev : list));
    for (const group of step.resolved) {
      const id = posted.current.get(group);
      if (id === undefined) continue;
      cancelSystemNotification(id);
      posted.current.delete(group);
    }
    const chime = chimeFor(step.fresh);
    if (!chime) return;
    const fresh = groupAlerts(step.fresh);
    setSignaled((prev) => new Set([...prev, ...fresh.map((a) => a.group)]));
    const { volume, system } = readAlertSettings();
    const postAll = async () => {
      let any = false;
      for (const a of fresh) {
        if (!memory.current.groups.has(a.group)) continue;
        const id = notificationId(a.group);
        if (await postSystemNotification({ id, title: a.title, body: a.body, target: a.target })) {
          posted.current.set(a.group, id);
          any = true;
        }
      }
      return any;
    };
    // Un seul son par événement. Arrière-plan ou écran éteint : la notification du système (son de
    // l'appareil). Au premier plan : le carillon ; s'il est refusé, la notification prend le relais.
    void (async () => {
      if (system && document.hidden && (await postAll())) return;
      if (!(await playChime(chime, volume)) && system) await postAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concerned, feed.orders, feed.requests, feed.loaded, notifications.items, notifications.loaded, signature]);

  // Tant qu'un client attend la salle (commande QR, appel, addition) : rappel toutes les 30 s.
  const reminder = profile.hall ? reminderChime(active) : null;
  useEffect(() => {
    if (!reminder) return;
    const id = setInterval(() => void playChime(reminder, readAlertSettings().volume), REMINDER_MS);
    return () => clearInterval(id);
  }, [reminder]);

  // Prise en charge : une notification traitée ne reste pas à lire, sur tous les appareils qui suivent le service.
  useEffect(() => {
    if (!feed.loaded || !notifications.loaded) return;
    const now = Date.now();
    const status = new Map(feed.orders.map((o) => [o.id, o.status]));
    const known = new Set([...feed.orders, ...feed.closed].map((o) => o.id));
    const open = new Set(feed.requests.map((r) => r.id));
    for (const n of notifications.items) {
      if (n.read || !n.entityId) continue;
      const settled = now - n.createdAt > SETTLE_MS;
      const seen = known.has(n.entityId) || settled;
      const state = status.get(n.entityId);
      const handled =
        (n.kind === 'ORDER_NEW' && state !== 'PENDING' && seen) ||
        // Prête → servie (ou terminée, annulée).
        (n.kind === 'ORDER_READY' && (state === 'SERVED' || (state === undefined && seen))) ||
        // Problème cuisine : clos avec la commande.
        (n.kind === 'KITCHEN_PROBLEM' && state === undefined && seen) ||
        ((n.kind === 'WAITER_CALL' || n.kind === 'BILL_REQUESTED') && !open.has(n.entityId) && settled);
      if (handled) notifications.markRead(n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.loaded, feed.orders, feed.closed, feed.requests, notifications.loaded, notifications.items]);

  const cards = groupAlerts(active.filter((a) => signaled.has(a.group) && !dismissed.has(a.group) && !(onKitchenScreen && a.kind === 'KITCHEN_TICKET')));
  return { cards, dismiss: (group) => setDismissed((prev) => new Set([...prev, group])) };
}

const MAX_CARDS = 3;

/** Cartes d'alerte en haut à droite : toucher ouvre l'écran concerné ; elles disparaissent une fois l'événement traité. */
export function AlertStack({ alerts, onOpen }: { alerts: StaffAlerts; onOpen: (target: AlertTarget) => void }) {
  if (alerts.cards.length === 0) return null;
  const shown = alerts.cards.slice(-MAX_CARDS).reverse();
  const more = alerts.cards.length - shown.length;
  return createPortal(
    <div className="staff-alerts" role="status" aria-live="polite">
      {shown.map((a) => (
        <div key={a.group} className={`staff-alert-card alert-${a.chime}`}>
          <button type="button" className="staff-alert-card-main" onClick={() => onOpen(a.target)}>
            <strong>{a.title}</strong>
            {a.body && <span>{a.body}</span>}
          </button>
          <button type="button" className="staff-alert-card-close" aria-label="Masquer l'alerte" onClick={() => alerts.dismiss(a.group)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
      {more > 0 && <div className="staff-alert-more">{more === 1 ? '1 autre alerte' : `${more} autres alertes`}</div>}
    </div>,
    document.body,
  );
}
