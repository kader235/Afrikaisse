import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Ticket, encodeCp850, wrapText } from '../src/lib/escpos.ts';
import { processPrintJobs } from '../src/services/printing.ts';
import { ENGINES, addMember, as, login, registerOrg, startApp, type TestApp } from './helpers.ts';

/** Fausse imprimante : un serveur TCP qui garde chaque ticket reçu. */
function fakePrinter(): Promise<{ server: Server; port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => received.push(Buffer.concat(chunks)));
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, received })));
}

const contains = (buf: Buffer, text: string) => buf.includes(Buffer.from(encodeCp850(text)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 40 && !check(); i++) await sleep(50);
}

describe('Phase 9 — encodeur ESC/POS', () => {
  it('accents en page 850, espaces des montants, coupure des lignes, colonnes', () => {
    expect(encodeCp850('é à ç É ô')).toEqual([0x82, 0x20, 0x85, 0x20, 0x87, 0x20, 0x90, 0x20, 0x93]);
    expect(encodeCp850('12 500 FCFA')).toEqual(encodeCp850('12 500 FCFA'));
    expect(encodeCp850('œ€')).toEqual(encodeCp850('oeEUR'));
    expect(wrapText('Brochettes de bœuf marinées au gingembre', 16)).toEqual(['Brochettes de', 'bœuf marinées au', 'gingembre']);
    const bytes = new Ticket(32).row('Total', '12 500 FCFA').cut().build();
    expect(contains(bytes, `${'Total'.padEnd(20)} 12 500 FCFA`)).toBe(true);
    expect(bytes.subarray(0, 5)).toEqual(Buffer.from([0x1b, 0x40, 0x1b, 0x74, 2]));
    expect(bytes.includes(Buffer.from([0x1d, 0x56, 0x42, 0x03]))).toBe(true);
  });
});

describe.each(ENGINES)('Phase 9 — impression — %s', (engine) => {
  let t: TestApp;
  let printer: Awaited<ReturnType<typeof fakePrinter>>;
  let closedPort: number;

  beforeAll(async () => {
    t = await startApp(engine);
    printer = await fakePrinter();
    const dead = await fakePrinter();
    closedPort = dead.port;
    await new Promise((r) => dead.server.close(r));
  });
  afterAll(async () => {
    await t.close();
    await new Promise((r) => printer.server.close(r));
  });

  it('tickets cuisine par poste à la confirmation, reçus, test, échecs relançables ; droits et isolation', async () => {
    const org = await registerOrg(t, 'Impression');
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const stations = (await owner.get(`/api/locations/${locationId}/stations`)).json();
    const cuisine = stations.find((s: { kind: string }) => s.kind === 'KITCHEN');
    const bar = stations.find((s: { kind: string }) => s.kind === 'BAR');
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Carte' })).json();
    const cat = menu.categories[0].id;
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Brochettes de bœuf', price: 3500 })).json();
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Jus de gingembre', price: 1000, stationId: bar.id })).json();
    const product = (n: string) => menu.products.find((p: { name: string }) => p.name === n);
    const qr = (await owner.get(`/api/locations/${locationId}/qr-codes`)).json().codes[0].token;

    const manager = as(t, (await login(t, (await addMember(t, org.token, 'MANAGER')).email)).json().accessToken);
    const waiter = as(t, (await login(t, (await addMember(t, org.token, 'WAITER')).email)).json().accessToken);
    const add = (who: ReturnType<typeof as>, body: object) => who.post(`/api/locations/${locationId}/printers`, body);
    expect((await add(waiter, { name: 'X', host: '127.0.0.1' })).statusCode).toBe(403);
    expect((await add(manager, { name: 'X', host: 'http://192.168.1.50' })).statusCode).toBe(400);
    const pCuisine = (await add(manager, { name: 'Cuisine', host: '127.0.0.1', port: printer.port, stationId: cuisine.id })).json();
    await add(manager, { name: 'Bar', host: '127.0.0.1', port: printer.port, width: 32, stationId: bar.id });
    const pCaisse = (await add(manager, { name: 'Caisse', host: '127.0.0.1', port: printer.port, printsKitchen: false, printsReceipts: true })).json();
    const list = (await waiter.get(`/api/locations/${locationId}/printers`)).json();
    expect(list.map((p: { name: string; stationName: string | null }) => [p.name, p.stationName])).toEqual([
      ['Bar', 'Bar'],
      ['Caisse', null],
      ['Cuisine', 'Cuisine'],
    ]);

    // Test : envoyé tout de suite.
    const tested = (await manager.post(`/api/printers/${pCaisse.id}/test`)).json();
    expect(tested.lastError).toBeNull();
    expect(typeof tested.lastOkAt).toBe('number');
    await waitFor(() => printer.received.length === 1);
    expect(contains(printer.received[0]!, "Test d'impression")).toBe(true);
    expect(contains(printer.received[0]!, 'é è à ç ô ù É')).toBe(true);

    // Commande en caisse : un ticket par poste, chacun avec SES articles.
    const order = (await owner.post(`/api/locations/${locationId}/orders`, { tableId: table.id, lines: [{ productId: product('Brochettes de bœuf').id, quantity: 2, note: 'Bien cuit' }, { productId: product('Jus de gingembre').id, quantity: 1 }] })).json();
    expect(await processPrintJobs(t.ctx)).toBe(2);
    await waitFor(() => printer.received.length === 3);
    const tickets = printer.received.slice(1);
    const kitchen = tickets.find((b) => contains(b, 'CUISINE'))!;
    const barTicket = tickets.find((b) => contains(b, 'BAR'))!;
    expect(contains(kitchen, '2 x Brochettes de bœuf')).toBe(true);
    expect(contains(kitchen, '>> Bien cuit')).toBe(true);
    expect(contains(kitchen, 'Jus de gingembre')).toBe(false);
    expect(contains(barTicket, '1 x Jus de gingembre')).toBe(true);
    expect(contains(barTicket, 'Brochettes')).toBe(false);
    for (const b of tickets) {
      expect(contains(b, 'Table T1')).toBe(true);
      expect(contains(b, `n°${order.number}`)).toBe(true);
    }

    // QR : rien avant la confirmation, un seul ticket après, même confirmé deux fois.
    const placed = (await t.app.inject({ method: 'POST', url: `/api/public/menu/${qr}/orders`, payload: { clientToken: 'client-impression-0001', lines: [{ productId: product('Jus de gingembre').id, quantity: 3 }] } })).json();
    expect(await processPrintJobs(t.ctx)).toBe(0);
    await owner.post(`/api/orders/${placed.id}/status`, { status: 'CONFIRMED' });
    await owner.post(`/api/orders/${placed.id}/status`, { status: 'CONFIRMED' });
    expect(await processPrintJobs(t.ctx)).toBe(1);

    // Reçu.
    await owner.post(`/api/locations/${locationId}/cash-sessions`, { openingFloat: 0 });
    const receipt = (await owner.post(`/api/locations/${locationId}/payments`, { target: { kind: 'order', id: order.id }, method: 'CASH', amount: 8000, tendered: 10000 })).json();
    const before = printer.received.length;
    expect((await owner.post(`/api/payments/${receipt.payment.id}/print`)).json()).toEqual({ jobs: 1 });
    expect(await processPrintJobs(t.ctx)).toBe(1);
    await waitFor(() => printer.received.length === before + 1);
    const paper = printer.received.at(-1)!;
    expect(contains(paper, 'Reçu n°000001')).toBe(true);
    expect(contains(paper, 'Rendu')).toBe(true);
    expect(contains(paper, 'Merci de votre visite')).toBe(true);

    // Imprimante en panne : trois tentatives espacées, puis échec visible, relançable.
    const dead = (await add(manager, { name: 'Hors service', host: '127.0.0.1', port: closedPort, printsKitchen: false, printsReceipts: true })).json();
    expect((await manager.post(`/api/printers/${dead.id}/test`)).json().lastError).toContain('injoignable');
    expect((await owner.post(`/api/payments/${receipt.payment.id}/print`)).json()).toEqual({ jobs: 2 });
    try {
      await processPrintJobs(t.ctx);
      t.clock.offsetMs = 6_000;
      await processPrintJobs(t.ctx);
      t.clock.offsetMs = 30_000;
      await processPrintJobs(t.ctx);
    } finally {
      t.clock.offsetMs = 0;
    }
    const jobs = (await manager.get(`/api/locations/${locationId}/print-jobs`)).json();
    const failed = jobs.find((j: { printerName: string }) => j.printerName === 'Hors service');
    expect(failed).toMatchObject({ kind: 'RECEIPT', status: 'FAILED', attempts: 3 });
    expect(failed.lastError).toContain('injoignable');
    expect(jobs.filter((j: { status: string }) => j.status === 'SENT').length).toBeGreaterThanOrEqual(5);
    expect((await manager.post(`/api/print-jobs/${failed.id}/retry`)).json()).toMatchObject({ status: 'PENDING', attempts: 0 });

    const other = as(t, (await registerOrg(t, 'ImpressionVoisin')).token);
    expect((await other.get(`/api/locations/${locationId}/printers`)).statusCode).toBe(404);
    expect((await other.post(`/api/printers/${pCuisine.id}/test`)).statusCode).toBe(404);
    expect((await other.post(`/api/print-jobs/${failed.id}/retry`)).statusCode).toBe(404);
  });

  it('imprimante « appareil » : la tablette vient chercher les tickets, les imprime, accuse réception ; le serveur ne les touche pas', async () => {
    const org = await registerOrg(t, 'ImpressionTablette');
    const owner = as(t, org.token);
    const locationId = org.me.locations[0].id as string;
    const zone = (await owner.post(`/api/locations/${locationId}/zones`, { name: 'Salle' })).json();
    const table = (await owner.post(`/api/zones/${zone.id}/tables`, { label: 'T1' })).json();
    let menu = (await owner.post(`/api/locations/${locationId}/categories`, { name: 'Carte' })).json();
    const cat = menu.categories[0].id;
    menu = (await owner.post(`/api/categories/${cat}/products`, { name: 'Thiéboudienne', price: 4000 })).json();
    const productId = menu.products[0].id;

    // Imprimante Bluetooth pilotée par la tablette : adresse MAC acceptée, aucun port réseau requis.
    const p = (await owner.post(`/api/locations/${locationId}/printers`, { name: 'Caisse tablette', host: 'DC:0D:30:AA:BB:CC', connection: 'bluetooth', driver: 'device', printsKitchen: true, printsReceipts: true })).json();
    expect(p).toMatchObject({ connection: 'bluetooth', driver: 'device' });

    // Test d'impression : le serveur ne peut pas l'atteindre, il met le ticket de test en file.
    await owner.post(`/api/printers/${p.id}/test`);

    // Une commande confirmée fabrique un ticket cuisine, comme pour une imprimante réseau.
    const order = (await owner.post(`/api/locations/${locationId}/orders`, { tableId: table.id, lines: [{ productId, quantity: 2 }] })).json();
    // Le serveur ne traite PAS les imprimantes « appareil » : rien n'est envoyé en TCP.
    expect(await processPrintJobs(t.ctx)).toBe(0);

    // La tablette réclame la file : elle reçoit le test + le ticket cuisine, avec les octets prêts.
    const queue = (await owner.get(`/api/locations/${locationId}/print-queue`)).json();
    expect(queue.length).toBe(2);
    expect(queue.map((q: { kind: string }) => q.kind).sort()).toEqual(['KITCHEN', 'TEST']);
    for (const item of queue) {
      expect(item).toMatchObject({ connection: 'bluetooth', host: 'DC:0D:30:AA:BB:CC', printerName: 'Caisse tablette' });
      const bytes = Buffer.from(item.payload, 'base64');
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40])); // initialisation ESC/POS
    }

    // Réservés : un second appel immédiat ne les rend pas une deuxième fois (pas de double impression).
    expect((await owner.get(`/api/locations/${locationId}/print-queue`)).json().length).toBe(0);

    // La tablette accuse réception : un ticket imprimé, l'autre en échec.
    const kitchen = queue.find((q: { kind: string }) => q.kind === 'KITCHEN');
    const test = queue.find((q: { kind: string }) => q.kind === 'TEST');
    expect((await owner.post(`/api/print-jobs/${kitchen.id}/ack`, { ok: true })).statusCode).toBe(204);
    expect((await owner.post(`/api/print-jobs/${test.id}/ack`, { ok: false, error: 'Imprimante hors tension' })).statusCode).toBe(204);

    const jobs = (await owner.get(`/api/locations/${locationId}/print-jobs`)).json();
    expect(jobs.find((j: { id: string }) => j.id === kitchen.id)).toMatchObject({ status: 'SENT' });
    expect(jobs.find((j: { id: string }) => j.id === test.id)).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Imprimante hors tension' });

    // Le ticket en échec revient dans la file après la fenêtre de réservation et le délai de reprise.
    try {
      t.clock.offsetMs = 60_000;
      const again = (await owner.get(`/api/locations/${locationId}/print-queue`)).json();
      expect(again.map((q: { id: string }) => q.id)).toEqual([test.id]);
    } finally {
      t.clock.offsetMs = 0;
    }

    // Isolation : une autre organisation ne voit ni la file ni les accusés de réception.
    const other = as(t, (await registerOrg(t, 'ImpressionTabletteVoisin')).token);
    expect((await other.get(`/api/locations/${locationId}/print-queue`)).statusCode).toBe(404);
    expect((await other.post(`/api/print-jobs/${kitchen.id}/ack`, { ok: true })).statusCode).toBe(404);
  });
});
