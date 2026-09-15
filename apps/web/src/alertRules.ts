import type { AppNotification, Order, OrderItem, Permission, ServiceRequest } from '@afrikaisse/core';

/**
 * Alertes du personnel : QUI entend QUOI. Logique pure (aucun DOM, aucun React) : testée dans
 * apps/web/test/alertRules.test.ts, appelée par alerts.tsx à chaque lecture du flux d'activité.
 *
 * - Cuisine / bar : un nouveau ticket à préparer pour ses postes (commande confirmée, QR ou personnel).
 * - Salle (orders.create) : commande QR à confirmer, appel de table, addition, commande prête, problème cuisine.
 * - Caisse (payments.collect) : addition demandée, commande servie à encaisser.
 * - Responsable / propriétaire : salle + caisse ; les tickets cuisine seulement sur l'écran cuisine.
 * Jamais d'alerte pour un geste qu'on a fait soi-même (commande saisie, confirmée, servie…).
 */

export type AlertKind = 'QR_ORDER' | 'KITCHEN_TICKET' | 'ORDER_READY' | 'ORDER_SERVED' | 'WAITER_CALL' | 'BILL_REQUESTED' | 'KITCHEN_PROBLEM';

/** Motif sonore : nouvelle commande, commande prête, appel (table, addition, problème). */
export type ChimeName = 'order' | 'ready' | 'call';

export type AlertTarget = 'orders' | 'kitchen';

export interface Alert {
  /** Clé d'anti-doublon : un événement ne sonne qu'une fois, même relu cent fois. */
  key: string;
  /** Regroupement affiché (un ticket = une carte, même avec plusieurs articles). */
  group: string;
  kind: AlertKind;
  source: AlertSource;
  chime: ChimeName;
  title: string;
  body: string | null;
  target: AlertTarget;
  at: number;
}

export type AlertSource = 'feed' | 'notifications';

export const CHIME_OF: Record<AlertKind, ChimeName> = {
  QR_ORDER: 'order',
  KITCHEN_TICKET: 'order',
  ORDER_READY: 'ready',
  ORDER_SERVED: 'ready',
  WAITER_CALL: 'call',
  BILL_REQUESTED: 'call',
  KITCHEN_PROBLEM: 'call',
};

/** Un seul son par lecture : le plus pressant l'emporte. */
const CHIME_RANK: Record<ChimeName, number> = { call: 3, order: 2, ready: 1 };

export interface KitchenScope {
  /** Poste choisi sur cet appareil ; null : « Tous ». */
  stationId: string | null;
  /** Postes permis au rôle ; null : liste pas encore connue (tout est pris). */
  allowedStationIds: readonly string[] | null;
}

export interface AlertProfile {
  userId: string;
  userName: string;
  hall: boolean;
  cashier: boolean;
  kitchen: boolean;
  kitchenScope: KitchenScope;
}

/**
 * Profil d'alerte d'un rôle. Les responsables ont aussi kitchen.use : les tickets cuisine ne les
 * dérangent que sur l'écran cuisine, sinon ils entendent la salle et la caisse.
 */
export function alertProfile(
  user: { id: string; displayName: string },
  permissions: readonly Permission[],
  options: { onKitchenScreen: boolean; kitchenScope?: KitchenScope },
): AlertProfile {
  const has = (p: Permission) => permissions.includes(p);
  const cook = has('kitchen.use') || has('bar.use');
  return {
    userId: user.id,
    userName: user.displayName,
    hall: has('orders.create'),
    cashier: has('payments.collect'),
    kitchen: cook && (options.onKitchenScreen || !has('orders.create')),
    kitchenScope: options.kitchenScope ?? { stationId: null, allowedStationIds: null },
  };
}

/** Signature du profil : quand elle change (autre écran, autre poste), l'existant est repris sans son. */
export function profileSignature(p: AlertProfile): string {
  const scope = p.kitchen ? `${p.kitchenScope.stationId ?? '*'}:${p.kitchenScope.allowedStationIds?.join(',') ?? '?'}` : '-';
  return [p.userId, p.hall ? 'H' : '', p.cashier ? 'C' : '', p.kitchen ? 'K' : '', scope].join('|');
}

/** Même règle que l'écran cuisine : un poste choisi ne voit que ses articles ; « Tous » voit aussi les articles sans poste. */
export function inKitchenScope(item: Pick<OrderItem, 'stationId'>, scope: KitchenScope): boolean {
  if (scope.stationId) return item.stationId === scope.stationId;
  if (!item.stationId) return true;
  return scope.allowedStationIds === null || scope.allowedStationIds.includes(item.stationId);
}

type HistoryEntry = Order['history'][number];

/** Geste fait par cet utilisateur (identifiant, ou nom affiché avec un serveur plus ancien). */
export function byUser(entry: HistoryEntry | undefined, profile: Pick<AlertProfile, 'userId' | 'userName'>): boolean {
  if (!entry) return false;
  if (entry.byUserId !== undefined) return entry.byUserId !== null && entry.byUserId === profile.userId;
  return entry.by !== null && entry.by === profile.userName;
}

/** Dernier passage de la commande à ce statut. */
function lastTo(order: Order, status: Order['status']): HistoryEntry | undefined {
  for (let i = order.history.length - 1; i >= 0; i--) if (order.history[i]!.to === status) return order.history[i];
  return undefined;
}

function place(o: { tableLabel: string | null; serviceType: string }): string {
  return o.tableLabel ? `Table ${o.tableLabel}` : o.serviceType === 'TAKEAWAY' ? 'À emporter' : o.serviceType === 'DELIVERY' ? 'Livraison' : 'Comptoir';
}

function alert(kind: AlertKind, source: AlertSource, key: string, group: string, title: string, body: string | null, target: AlertTarget, at: number): Alert {
  return { key, group, kind, source, chime: CHIME_OF[kind], title, body, target, at };
}

export interface AlertInput {
  orders: readonly Order[];
  requests: readonly ServiceRequest[];
  notifications: readonly AppNotification[];
}

/** Alertes EN COURS pour ce profil : ce qui attend encore quelqu'un. Une alerte traitée n'y figure plus. */
export function activeAlerts(input: AlertInput, profile: AlertProfile): Alert[] {
  const out: Alert[] = [];
  for (const order of input.orders) {
    const number = `n°${order.number}`;
    if (profile.hall && order.status === 'PENDING' && order.source === 'QR') {
      out.push(alert('QR_ORDER', 'feed', `qr:${order.id}`, `qr:${order.id}`, `Nouvelle commande ${number} à confirmer`, `${place(order)} · QR`, 'orders', order.createdAt));
    }
    if (profile.kitchen && (order.status === 'CONFIRMED' || order.status === 'PREPARING')) {
      const mine = byUser(order.history[0], profile) || byUser(lastTo(order, 'CONFIRMED'), profile);
      const queued = mine ? [] : order.items.filter((i) => i.kdsStatus === 'QUEUED' && inKitchenScope(i, profile.kitchenScope));
      if (queued.length > 0) {
        const count = queued.reduce((sum, i) => sum + i.quantity, 0);
        const body = `${place(order)} · ${count} article${count > 1 ? 's' : ''}`;
        for (const item of queued) {
          out.push(alert('KITCHEN_TICKET', 'feed', `ticket:${item.id}`, `ticket:${order.id}`, `Nouveau ticket ${number}`, body, 'kitchen', order.statusChangedAt));
        }
      }
    }
    if (profile.hall && order.status === 'READY' && !byUser(lastTo(order, 'READY'), profile)) {
      out.push(alert('ORDER_READY', 'feed', `ready:${order.id}`, `ready:${order.id}`, `Commande ${number} prête`, place(order), 'orders', order.statusChangedAt));
    }
    if (profile.cashier && order.status === 'SERVED' && order.paymentStatus !== 'PAID' && !byUser(lastTo(order, 'SERVED'), profile)) {
      out.push(alert('ORDER_SERVED', 'feed', `served:${order.id}`, `served:${order.id}`, `Commande ${number} servie · à encaisser`, place(order), 'orders', order.statusChangedAt));
    }
  }
  for (const request of input.requests) {
    if (request.status !== 'OPEN') continue;
    const where = `Table ${request.tableLabel}`;
    if (request.kind === 'BILL') {
      if (profile.hall || profile.cashier) {
        out.push(alert('BILL_REQUESTED', 'feed', `bill:${request.id}`, `bill:${request.id}`, `${where} demande l'addition`, request.guestName, 'orders', request.createdAt));
      }
    } else if (profile.hall) {
      const title = request.kind === 'HELP' ? `${where} demande de l'aide` : `${where} appelle un serveur`;
      out.push(alert('WAITER_CALL', 'feed', `call:${request.id}`, `call:${request.id}`, title, request.guestName, 'orders', request.createdAt));
    }
  }
  if (profile.hall) {
    for (const n of input.notifications) {
      if (n.kind !== 'KITCHEN_PROBLEM' || n.read) continue;
      out.push(alert('KITCHEN_PROBLEM', 'notifications', `problem:${n.id}`, `problem:${n.id}`, n.title, n.body, 'orders', n.createdAt));
    }
  }
  return out;
}

export interface AlertMemory {
  /** Clés déjà signalées (ou présentes au démarrage). */
  known: Set<string>;
  /** Sources déjà lues une première fois : leur existant ne sonne pas. */
  seeded: Set<AlertSource>;
  signature: string | null;
  /** Groupes en cours à la lecture précédente. */
  groups: Set<string>;
}

export function newAlertMemory(): AlertMemory {
  return { known: new Set(), seeded: new Set(), signature: null, groups: new Set() };
}

export interface AlertStep {
  /** Nouvelles alertes à signaler (son, notification système). */
  fresh: Alert[];
  /** Groupes qui ne sont plus en cours : leur notification système est retirée. */
  resolved: string[];
}

/**
 * Compare les alertes en cours avec la mémoire. Au premier chargement d'une source, ou quand le
 * profil change (changement d'écran ou de poste), l'existant est mémorisé sans signal.
 */
export function stepAlerts(memory: AlertMemory, active: readonly Alert[], signature: string, ready: Record<AlertSource, boolean>): AlertStep {
  const reseed = memory.signature !== signature;
  memory.signature = signature;
  const fresh: Alert[] = [];
  for (const source of ['feed', 'notifications'] as const) {
    if (!ready[source]) continue;
    const silent = reseed || !memory.seeded.has(source);
    memory.seeded.add(source);
    for (const a of active) {
      if (a.source !== source || memory.known.has(a.key)) continue;
      memory.known.add(a.key);
      if (!silent) fresh.push(a);
    }
  }
  const groups = new Set(active.map((a) => a.group));
  const resolved = [...memory.groups].filter((g) => !groups.has(g));
  memory.groups = groups;
  return { fresh, resolved };
}

/** Motif à jouer pour un lot de nouvelles alertes (un seul son, jamais deux à la suite). */
export function chimeFor(alerts: readonly Alert[]): ChimeName | null {
  let best: ChimeName | null = null;
  for (const a of alerts) if (best === null || CHIME_RANK[a.chime] > CHIME_RANK[best]) best = a.chime;
  return best;
}

/** Une carte par groupe (la plus récente des alertes du groupe), dans l'ordre d'arrivée. */
export function groupAlerts(alerts: readonly Alert[]): Alert[] {
  const byGroup = new Map<string, Alert>();
  for (const a of alerts) if (!byGroup.has(a.group)) byGroup.set(a.group, a);
  return [...byGroup.values()].sort((a, b) => a.at - b.at);
}

/** Rappel toutes les 30 s tant qu'un client attend la salle (commande QR, appel, addition). */
export function reminderChime(active: readonly Alert[]): ChimeName | null {
  return chimeFor(active.filter((a) => a.kind === 'QR_ORDER' || a.kind === 'WAITER_CALL' || a.kind === 'BILL_REQUESTED'));
}

/** Identifiant numérique stable (31 bits, non nul) d'un groupe, pour la notification Android. */
export function notificationId(group: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < group.length; i++) {
    hash ^= group.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}
