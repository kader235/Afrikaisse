import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, type AppNotification, type Order, type OrderItem, type Role, type ServiceRequest } from '@afrikaisse/core';
import {
  activeAlerts,
  alertProfile,
  chimeFor,
  groupAlerts,
  inKitchenScope,
  newAlertMemory,
  notificationId,
  profileSignature,
  reminderChime,
  stepAlerts,
  type AlertInput,
  type AlertKind,
  type AlertProfile,
} from '../src/alertRules.ts';

const ME = { id: 'u-me', displayName: 'Moi Même' };
const OTHER = 'u-other';

const profileOf = (role: Role, onKitchenScreen = false, stationId: string | null = null, allowed: string[] | null = null): AlertProfile =>
  alertProfile(ME, ROLE_PERMISSIONS[role], { onKitchenScreen, kitchenScope: { stationId, allowedStationIds: allowed } });

function item(id: string, over: Partial<OrderItem> = {}): OrderItem {
  return { id, productId: 'p', name: 'Riz', variantName: null, unitPrice: 1000, quantity: 1, total: 1000, promotionName: null, promotionDiscount: 0, note: null, modifiers: [], stationId: null, kdsStatus: 'QUEUED', ...over };
}

function order(id: string, over: Partial<Order> = {}): Order {
  return {
    id,
    locationId: 'l',
    number: 12,
    businessDate: '2026-09-15',
    source: 'WAITER',
    status: 'CONFIRMED',
    tableId: 't',
    tableLabel: '4',
    sessionId: null,
    guestName: null,
    note: null,
    serviceType: 'DINE_IN',
    customerName: null,
    currency: 'XAF',
    subtotal: 1000,
    promotionDiscount: 0,
    promotions: [],
    promoCode: null,
    discount: 0,
    discountReason: null,
    taxMode: 'NONE',
    taxTotal: 0,
    taxes: [],
    total: 1000,
    paid: 0,
    paymentStatus: 'UNPAID',
    itemCount: 1,
    items: [item(`${id}-i1`)],
    createdAt: 1000,
    statusChangedAt: 1000,
    history: [{ from: null, to: 'CONFIRMED', at: 1000, by: 'Awa', byUserId: OTHER, reason: null }],
    ...over,
  } as Order;
}

function request(id: string, kind: ServiceRequest['kind'], over: Partial<ServiceRequest> = {}): ServiceRequest {
  return { id, locationId: 'l', tableId: 't', tableLabel: '7', kind, status: 'OPEN', createdAt: 2000, handledAt: null, handledBy: null, paymentMethod: null, billScope: null, guestName: null, amount: null, ...over };
}

function problem(id: string, over: Partial<AppNotification> = {}): AppNotification {
  return { id, seq: 1, locationId: 'l', kind: 'KITCHEN_PROBLEM', urgent: true, title: 'Problème cuisine · commande n°12', body: 'Produit manquant', data: {}, entityType: 'order', entityId: 'o1', createdAt: 3000, read: false, ...over };
}

const input = (over: Partial<AlertInput> = {}): AlertInput => ({ orders: [], requests: [], notifications: [], ...over });
const kinds = (profile: AlertProfile, data: AlertInput): AlertKind[] => [...new Set(activeAlerts(data, profile).map((a) => a.kind))].sort();

const everything = input({
  orders: [
    order('qr', { source: 'QR', status: 'PENDING', history: [{ from: null, to: 'PENDING', at: 1, by: 'Client (QR)', byUserId: null, reason: null }] }),
    order('new'),
    order('ready', { status: 'READY', history: [{ from: 'PREPARING', to: 'READY', at: 5, by: 'Cuisine', byUserId: OTHER, reason: null }] }),
    order('served', { status: 'SERVED', history: [{ from: 'READY', to: 'SERVED', at: 6, by: 'Awa', byUserId: OTHER, reason: null }] }),
  ],
  requests: [request('call', 'CALL_WAITER'), request('bill', 'BILL')],
  notifications: [problem('pb')],
});

describe('alertes du personnel : qui entend quoi', () => {
  it('cuisine et bar : seulement les tickets à préparer, sur tous les écrans', () => {
    expect(kinds(profileOf('KITCHEN'), everything)).toEqual(['KITCHEN_TICKET']);
    expect(kinds(profileOf('BAR'), everything)).toEqual(['KITCHEN_TICKET']);
  });

  it('serveur : commande QR, appel, addition, commande prête, problème cuisine', () => {
    expect(kinds(profileOf('WAITER'), everything)).toEqual(['BILL_REQUESTED', 'KITCHEN_PROBLEM', 'ORDER_READY', 'QR_ORDER', 'WAITER_CALL']);
  });

  it('caissier : la salle, plus les commandes servies à encaisser', () => {
    expect(kinds(profileOf('CASHIER'), everything)).toEqual(['BILL_REQUESTED', 'KITCHEN_PROBLEM', 'ORDER_READY', 'ORDER_SERVED', 'QR_ORDER', 'WAITER_CALL']);
  });

  it('responsable et propriétaire : salle + caisse, tickets cuisine uniquement sur l’écran cuisine', () => {
    for (const role of ['MANAGER', 'OWNER'] as const) {
      expect(kinds(profileOf(role), everything)).not.toContain('KITCHEN_TICKET');
      expect(kinds(profileOf(role), everything)).toContain('ORDER_SERVED');
      expect(kinds(profileOf(role, true), everything)).toContain('KITCHEN_TICKET');
    }
  });

  it('gestionnaire de stock : rien', () => {
    expect(kinds(profileOf('STOCK_MANAGER'), everything)).toEqual([]);
  });

  it('jamais pour son propre geste : commande saisie, confirmée, marquée prête ou servie par soi', () => {
    const mine = { by: ME.displayName, byUserId: ME.id, reason: null };
    const data = input({
      orders: [
        order('created', { history: [{ from: null, to: 'CONFIRMED', at: 1, ...mine }] }),
        order('confirmed', { history: [{ from: null, to: 'PENDING', at: 1, by: 'Client (QR)', byUserId: null, reason: null }, { from: 'PENDING', to: 'CONFIRMED', at: 2, ...mine }] }),
        order('ready', { status: 'READY', history: [{ from: 'PREPARING', to: 'READY', at: 5, ...mine }] }),
        order('served', { status: 'SERVED', history: [{ from: 'READY', to: 'SERVED', at: 6, ...mine }] }),
      ],
    });
    expect(activeAlerts(data, profileOf('OWNER', true))).toEqual([]);
  });

  it('serveur plus ancien sans identifiant : comparaison sur le nom affiché', () => {
    const data = input({ orders: [order('o', { history: [{ from: null, to: 'CONFIRMED', at: 1, by: ME.displayName, reason: null }] })] });
    expect(activeAlerts(data, profileOf('KITCHEN'))).toEqual([]);
    const other = input({ orders: [order('o', { history: [{ from: null, to: 'CONFIRMED', at: 1, by: 'Awa', reason: null }] })] });
    expect(activeAlerts(other, profileOf('KITCHEN'))).toHaveLength(1);
  });

  it('commande QR en attente : pas encore en cuisine ; payée et servie : rien à encaisser', () => {
    const data = input({ orders: [order('qr', { source: 'QR', status: 'PENDING' }), order('paid', { status: 'SERVED', paymentStatus: 'PAID' })] });
    expect(kinds(profileOf('KITCHEN'), data)).toEqual([]);
    expect(kinds(profileOf('CASHIER'), data)).toEqual(['QR_ORDER']);
  });

  it('postes : un poste choisi ne voit que ses articles ; « Tous » voit les articles sans poste et ses postes permis', () => {
    expect(inKitchenScope({ stationId: 'bar' }, { stationId: 'cuisine', allowedStationIds: null })).toBe(false);
    expect(inKitchenScope({ stationId: null }, { stationId: 'cuisine', allowedStationIds: null })).toBe(false);
    expect(inKitchenScope({ stationId: null }, { stationId: null, allowedStationIds: ['cuisine'] })).toBe(true);
    expect(inKitchenScope({ stationId: 'bar' }, { stationId: null, allowedStationIds: ['cuisine'] })).toBe(false);
    expect(inKitchenScope({ stationId: 'bar' }, { stationId: null, allowedStationIds: null })).toBe(true);
    const drinks = input({ orders: [order('o', { items: [item('i1', { stationId: 'bar' })] })] });
    expect(activeAlerts(drinks, profileOf('KITCHEN', false, null, ['cuisine']))).toEqual([]);
    expect(activeAlerts(drinks, profileOf('BAR', false, null, ['bar']))).toHaveLength(1);
  });

  it('ticket lancé (article en préparation) : l’alerte n’est plus en cours', () => {
    const data = input({ orders: [order('o', { status: 'PREPARING', items: [item('i1', { kdsStatus: 'PREPARING' })] })] });
    expect(activeAlerts(data, profileOf('KITCHEN'))).toEqual([]);
  });

  it('problème cuisine lu : plus d’alerte', () => {
    expect(activeAlerts(input({ notifications: [problem('pb', { read: true })] }), profileOf('WAITER'))).toEqual([]);
  });
});

describe('anti-doublon et disparition', () => {
  const ready = { feed: true, notifications: true };

  it('premier chargement : l’existant ne sonne pas ; un nouvel événement sonne une seule fois', () => {
    const memory = newAlertMemory();
    const profile = profileOf('WAITER');
    const sig = profileSignature(profile);
    const first = input({ requests: [request('r1', 'CALL_WAITER')] });
    expect(stepAlerts(memory, activeAlerts(first, profile), sig, ready).fresh).toEqual([]);
    const second = input({ requests: [request('r1', 'CALL_WAITER'), request('r2', 'BILL')] });
    const step = stepAlerts(memory, activeAlerts(second, profile), sig, ready);
    expect(step.fresh.map((a) => a.key)).toEqual(['bill:r2']);
    expect(stepAlerts(memory, activeAlerts(second, profile), sig, ready).fresh).toEqual([]);
  });

  it('une source pas encore chargée ne se rattrape pas en sonnant son existant', () => {
    const memory = newAlertMemory();
    const profile = profileOf('WAITER');
    const sig = profileSignature(profile);
    stepAlerts(memory, [], sig, { feed: true, notifications: false });
    const later = activeAlerts(input({ notifications: [problem('old')] }), profile);
    expect(stepAlerts(memory, later, sig, ready).fresh).toEqual([]);
    const fresh = activeAlerts(input({ notifications: [problem('old'), problem('new')] }), profile);
    expect(stepAlerts(memory, fresh, sig, ready).fresh.map((a) => a.key)).toEqual(['problem:new']);
  });

  it('changement de poste ou d’écran : les tickets existants du nouveau périmètre ne sonnent pas', () => {
    const memory = newAlertMemory();
    const data = input({ orders: [order('o', { items: [item('i-bar', { stationId: 'bar' })] })] });
    const cuisine = profileOf('OWNER', true, 'cuisine');
    stepAlerts(memory, activeAlerts(data, cuisine), profileSignature(cuisine), ready);
    const all = profileOf('OWNER', true, null);
    expect(stepAlerts(memory, activeAlerts(data, all), profileSignature(all), ready).fresh).toEqual([]);
    const more = input({ orders: [order('o', { items: [item('i-bar', { stationId: 'bar' })] }), order('p')] });
    expect(stepAlerts(memory, activeAlerts(more, all), profileSignature(all), ready).fresh.map((a) => a.group)).toEqual(['ticket:p']);
  });

  it('article ajouté à un ticket déjà signalé : nouveau signal', () => {
    const memory = newAlertMemory();
    const profile = profileOf('KITCHEN');
    const sig = profileSignature(profile);
    stepAlerts(memory, activeAlerts(input({ orders: [order('o')] }), profile), sig, ready);
    const added = input({ orders: [order('o', { items: [item('o-i1', { kdsStatus: 'PREPARING' }), item('o-i2')] })] });
    expect(stepAlerts(memory, activeAlerts(added, profile), sig, ready).fresh.map((a) => a.key)).toEqual(['ticket:o-i2']);
  });

  it('groupes résolus : ticket lancé, commande servie, addition traitée', () => {
    const memory = newAlertMemory();
    const profile = profileOf('CASHIER');
    const sig = profileSignature(profile);
    const before = input({ orders: [order('r', { status: 'READY' })], requests: [request('b', 'BILL')] });
    stepAlerts(memory, activeAlerts(before, profile), sig, ready);
    const after = input({ orders: [order('r', { status: 'SERVED', paymentStatus: 'PAID' })] });
    expect(stepAlerts(memory, activeAlerts(after, profile), sig, ready).resolved.sort()).toEqual(['bill:b', 'ready:r']);
  });

  it('plusieurs articles d’un ticket : une carte, un son', () => {
    const profile = profileOf('KITCHEN');
    const data = input({ orders: [order('o', { items: [item('a'), item('b', { quantity: 2 })] })] });
    const list = activeAlerts(data, profile);
    expect(list).toHaveLength(2);
    expect(groupAlerts(list)).toHaveLength(1);
    expect(groupAlerts(list)[0]!.body).toBe('Table 4 · 3 articles');
  });
});

describe('motifs sonores', () => {
  it('un seul son par lot, le plus pressant l’emporte', () => {
    const list = activeAlerts(everything, profileOf('CASHIER'));
    expect(chimeFor(list)).toBe('call');
    expect(chimeFor(list.filter((a) => a.kind === 'ORDER_READY'))).toBe('ready');
    expect(chimeFor(list.filter((a) => a.kind === 'QR_ORDER' || a.kind === 'ORDER_READY'))).toBe('order');
    expect(chimeFor([])).toBeNull();
  });

  it('rappel : seulement quand un client attend la salle', () => {
    expect(reminderChime(activeAlerts(input({ orders: [order('r', { status: 'READY' })] }), profileOf('WAITER')))).toBeNull();
    expect(reminderChime(activeAlerts(input({ requests: [request('c', 'HELP')] }), profileOf('WAITER')))).toBe('call');
  });

  it('identifiant de notification Android : stable, positif, 31 bits', () => {
    const id = notificationId('ticket:0190-abc');
    expect(id).toBe(notificationId('ticket:0190-abc'));
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
    expect(notificationId('ready:a')).not.toBe(notificationId('ready:b'));
  });
});
