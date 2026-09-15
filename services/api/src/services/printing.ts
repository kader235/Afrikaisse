import type { Selectable } from 'kysely';
import {
  AppError,
  PAYMENT_METHOD_LABELS,
  SERVICE_TYPE_LABELS,
  formatMoney,
  formatRate,
  mergeTaxLines,
  uuidv7,
  type CreatePrinterInput,
  type Order,
  type Printer,
  type PrintJob,
  type Receipt,
  type UpdatePrinterInput,
} from '@afrikaisse/core';
import type { PrintersTable } from '@afrikaisse/database';
import type { AppContext, Db, RequestMeta } from '../context.ts';
import type { TenantScope } from '../lib/access.ts';
import { Ticket, sendToPrinter } from '../lib/escpos.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { assertLocation, hydrateOrders } from './orders.ts';
import { getReceipt } from './pos.ts';

/**
 * Impression (phase 9). Une commande confirmée met en file un ticket par imprimante de cuisine
 * (celle de son poste, ou celle qui imprime tous les postes). La file est vidée par le serveur
 * local : trois tentatives espacées, puis « échec » visible et relançable. Une imprimante en
 * panne ne bloque jamais une vente.
 */

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

type PrinterRow = Selectable<PrintersTable>;

async function toPrinters(db: Db, rows: PrinterRow[]): Promise<Printer[]> {
  const stationIds = [...new Set(rows.map((r) => r.station_id).filter((x): x is string => !!x))];
  const stations = stationIds.length ? await db.selectFrom('stations').select(['id', 'name']).where('id', 'in', stationIds).execute() : [];
  return rows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    name: r.name,
    host: r.host,
    port: r.port,
    width: r.width,
    stationId: r.station_id,
    stationName: stations.find((s) => s.id === r.station_id)?.name ?? null,
    printsKitchen: r.prints_kitchen === 1,
    printsReceipts: r.prints_receipts === 1,
    lastOkAt: r.last_ok_at,
    lastError: r.last_error,
  }));
}

async function findPrinter(db: Db, scope: TenantScope, printerId: string) {
  const row = await db.selectFrom('printers').selectAll().where('id', '=', printerId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!row || row.status !== 'ACTIVE' || (scope.locationId && row.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', 'Imprimante introuvable.');
  return row;
}

async function onePrinter(db: Db, id: string) {
  return (await toPrinters(db, [await db.selectFrom('printers').selectAll().where('id', '=', id).executeTakeFirstOrThrow()]))[0]!;
}

async function assertStationOf(db: Db, locationId: string, stationId: string | null | undefined) {
  if (!stationId) return;
  const station = await db.selectFrom('stations').select('id').where('id', '=', stationId).where('location_id', '=', locationId).where('status', '=', 'ACTIVE').executeTakeFirst();
  if (!station) throw new AppError('NOT_FOUND', 'Poste de préparation introuvable.');
}

async function emitPrinter(trx: Db, ctx: AppContext, id: string, hlc: string) {
  const row = await trx.selectFrom('printers').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  await recordChange(trx, ctx, { tenantId: row.tenant_id, locationId: row.location_id, entityType: 'printer', entityId: id, operation: 'UPSERT', payload: row, hlc });
}

// --- Imprimantes -------------------------------------------------------------

export async function listPrinters(ctx: AppContext, scope: TenantScope, locationId: string): Promise<Printer[]> {
  await assertLocation(ctx.db, scope, locationId);
  return toPrinters(ctx.db, await ctx.db.selectFrom('printers').selectAll().where('location_id', '=', locationId).where('status', '=', 'ACTIVE').orderBy('name').execute());
}

export async function createPrinter(ctx: AppContext, scope: TenantScope, locationId: string, input: CreatePrinterInput, meta: RequestMeta): Promise<Printer> {
  await assertLocation(ctx.db, scope, locationId);
  await assertStationOf(ctx.db, locationId, input.stationId);
  const id = uuidv7();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    const now = ctx.now();
    await trx
      .insertInto('printers')
      .values({
        id,
        tenant_id: scope.tenantId,
        location_id: locationId,
        name: input.name,
        host: input.host,
        port: input.port,
        width: input.width,
        station_id: input.stationId,
        prints_kitchen: input.printsKitchen ? 1 : 0,
        prints_receipts: input.printsReceipts ? 1 : 0,
        status: 'ACTIVE',
        last_ok_at: null,
        last_error: null,
        created_at: now,
        updated_at: now,
        updated_hlc: hlc,
      })
      .execute();
    await emitPrinter(trx, ctx, id, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId, actorUserId: scope.userId, action: 'printer.created', entityType: 'printer', entityId: id, data: input, meta });
  });
  return onePrinter(ctx.db, id);
}

export async function updatePrinter(ctx: AppContext, scope: TenantScope, printerId: string, input: UpdatePrinterInput, meta: RequestMeta): Promise<Printer> {
  const printer = await findPrinter(ctx.db, scope, printerId);
  await assertStationOf(ctx.db, printer.location_id, input.stationId);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx
      .updateTable('printers')
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.host !== undefined && { host: input.host }),
        ...(input.port !== undefined && { port: input.port }),
        ...(input.width !== undefined && { width: input.width }),
        ...(input.stationId !== undefined && { station_id: input.stationId }),
        ...(input.printsKitchen !== undefined && { prints_kitchen: input.printsKitchen ? 1 : 0 }),
        ...(input.printsReceipts !== undefined && { prints_receipts: input.printsReceipts ? 1 : 0 }),
        updated_at: ctx.now(),
        updated_hlc: hlc,
      })
      .where('id', '=', printerId)
      .execute();
    await emitPrinter(trx, ctx, printerId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: printer.location_id, actorUserId: scope.userId, action: 'printer.updated', entityType: 'printer', entityId: printerId, data: input, meta });
  });
  return onePrinter(ctx.db, printerId);
}

export async function archivePrinter(ctx: AppContext, scope: TenantScope, printerId: string, meta: RequestMeta): Promise<void> {
  const printer = await findPrinter(ctx.db, scope, printerId);
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('printers').set({ status: 'ARCHIVED', updated_at: ctx.now(), updated_hlc: hlc }).where('id', '=', printerId).execute();
    // Plus rien ne partira vers elle.
    await trx.updateTable('print_jobs').set({ status: 'FAILED', last_error: 'Imprimante archivée.' }).where('printer_id', '=', printerId).where('status', '=', 'PENDING').execute();
    await emitPrinter(trx, ctx, printerId, hlc);
    await writeAudit(trx, ctx, { tenantId: scope.tenantId, locationId: printer.location_id, actorUserId: scope.userId, action: 'printer.archived', entityType: 'printer', entityId: printerId, data: { name: printer.name }, meta });
  });
}

/** Impression de test, envoyée tout de suite : le résultat s'affiche dans la réponse. */
export async function testPrinter(ctx: AppContext, scope: TenantScope, printerId: string): Promise<Printer> {
  const printer = await findPrinter(ctx.db, scope, printerId);
  const location = await ctx.db.selectFrom('locations').select(['name', 'timezone', 'currency']).where('id', '=', printer.location_id).executeTakeFirstOrThrow();
  const ticket = new Ticket(printer.width === 32 ? 32 : 48)
    .align('center')
    .bold(true)
    .big(true)
    .text('AfriKaisse')
    .big(false)
    .text("Test d'impression")
    .bold(false)
    .text(location.name)
    .text(`${printer.name} · ${printer.host}:${printer.port}`)
    .text(dateTime(ctx.now(), location.timezone))
    .align('left')
    .rule()
    .row('Accents', 'é è à ç ô ù É')
    .row('Montant', formatMoney(1250000, location.currency))
    .rule()
    .feed(3)
    .cut();
  try {
    await sendToPrinter(printer.host, printer.port, ticket.build());
    await ctx.db.updateTable('printers').set({ last_ok_at: ctx.now(), last_error: null }).where('id', '=', printerId).execute();
  } catch (err) {
    await ctx.db.updateTable('printers').set({ last_error: (err as Error).message }).where('id', '=', printerId).execute();
  }
  return onePrinter(ctx.db, printerId);
}

// --- Tickets -------------------------------------------------------------------

const time = (ms: number, timeZone: string) => new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(ms);
const dateTime = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms);

function kitchenTicket(order: Order, items: Order['items'], station: string, width: 48 | 32, timeZone: string): string {
  const t = new Ticket(width)
    .align('center')
    .bold(true)
    .text(station.toUpperCase())
    .big(true)
    .text(`n°${order.number}`)
    .big(false)
    .text(order.tableLabel ? `Table ${order.tableLabel}` : `${SERVICE_TYPE_LABELS[order.serviceType]}${order.customerName ? ` · ${order.customerName}` : ''}`)
    .bold(false)
    .text(time(order.createdAt, timeZone))
    .align('left')
    .rule();
  for (const i of items) {
    t.bold(true).wrap(`${i.quantity} x ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`).bold(false);
    if (i.modifiers.length) t.wrap(`   ${i.modifiers.map((m) => m.name).join(', ')}`);
    if (i.note) t.bold(true).wrap(`   >> ${i.note}`).bold(false);
  }
  t.rule();
  if (order.note) t.bold(true).wrap(`Note : ${order.note}`).bold(false);
  return t.feed(3).cut().build().toString('base64');
}

function receiptTicket(r: Receipt, width: 48 | 32, timeZone: string): string {
  const money = (v: number) => formatMoney(v, r.location.currency);
  const p = r.payment;
  const t = new Ticket(width).align('center').bold(true).text(r.location.name).bold(false);
  if (r.organization !== r.location.name) t.text(r.organization);
  if (r.location.address) t.wrap(r.location.address);
  if (r.location.phone) t.text(`Tél. ${r.location.phone}`);
  t.align('left').rule().row(`Reçu n°${String(p.receiptNumber).padStart(6, '0')}`, dateTime(p.createdAt, timeZone));
  if (r.cashier) t.text(`Caissier : ${r.cashier}`);
  if (p.status === 'VOIDED') t.align('center').bold(true).text('PAIEMENT ANNULÉ').bold(false).align('left');
  t.rule();
  for (const o of r.orders) {
    t.bold(true).text(`Commande n°${o.number} · ${o.tableLabel ? `Table ${o.tableLabel}` : SERVICE_TYPE_LABELS[o.serviceType]}`).bold(false);
    for (const i of o.items) {
      t.row(`${i.quantity} x ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`, money(i.total));
      if (i.modifiers.length) t.wrap(`   ${i.modifiers.map((m) => m.name).join(', ')}`);
    }
    for (const promo of o.promotions) t.row(promo.code ? `Code ${promo.code}` : promo.name, `-${money(promo.amount)}`);
    if (o.discount > 0) t.row(`Remise${o.discountReason ? ` (${o.discountReason})` : ''}`, `-${money(o.discount)}`);
  }
  const total = r.orders.reduce((s, o) => s + o.total, 0);
  const taxes = mergeTaxLines(r.orders.map((o) => o.taxes));
  const taxTotal = taxes.reduce((s, x) => s + x.tax, 0);
  t.rule();
  if (taxes.length > 0 && r.orders.some((o) => o.taxMode === 'EXCLUSIVE')) {
    t.row('Total HT', money(total - taxTotal));
    for (const x of taxes) t.row(`${x.name} ${formatRate(x.rateBp)}`, money(x.tax));
    t.bold(true).row('Total TTC', money(total)).bold(false);
  } else {
    t.bold(true).row('Total', money(total)).bold(false);
    for (const x of taxes) t.row(`dont ${x.name} ${formatRate(x.rateBp)}`, money(x.tax));
  }
  t.row(`Payé · ${PAYMENT_METHOD_LABELS[p.method]}${p.provider ? ` ${p.provider}` : ''}`, money(p.amount));
  if (p.method === 'CASH' && p.tendered > p.amount) t.row('Remis', money(p.tendered)).row('Rendu', money(p.change));
  if (p.reference) t.text(`Réf. ${p.reference}`);
  if (r.remaining > 0) t.bold(true).row('Reste à payer', money(r.remaining)).bold(false);
  else t.align('center').bold(true).text('Réglé - merci').bold(false);
  return t.align('center').rule().text('Merci de votre visite').feed(3).cut().build().toString('base64');
}

async function queue(trx: Db, ctx: AppContext, printer: { id: string; tenant_id: string; location_id: string }, kind: PrintJob['kind'], payload: string, orderId: string | null) {
  const now = ctx.now();
  await trx
    .insertInto('print_jobs')
    .values({ id: uuidv7(), tenant_id: printer.tenant_id, location_id: printer.location_id, printer_id: printer.id, kind, status: 'PENDING', payload, attempts: 0, last_error: null, order_id: orderId, next_attempt_at: now, created_at: now, sent_at: null })
    .execute();
}

/** Tickets cuisine d'une commande confirmée, un par imprimante concernée. Sans effet si déjà fait. */
export async function enqueueKitchenTickets(trx: Db, ctx: AppContext, order: { id: string; location_id: string }) {
  const printers = await trx.selectFrom('printers').selectAll().where('location_id', '=', order.location_id).where('status', '=', 'ACTIVE').where('prints_kitchen', '=', 1).execute();
  if (printers.length === 0) return;
  const done = await trx.selectFrom('print_jobs').select('id').where('order_id', '=', order.id).where('kind', '=', 'KITCHEN').executeTakeFirst();
  if (done) return;
  const [hydrated] = await hydrateOrders(trx, await trx.selectFrom('orders').selectAll().where('id', '=', order.id).execute());
  if (!hydrated) return;
  const location = await trx.selectFrom('locations').select('timezone').where('id', '=', order.location_id).executeTakeFirstOrThrow();
  const stations = await trx.selectFrom('stations').select(['id', 'name']).where('location_id', '=', order.location_id).execute();
  for (const p of printers) {
    const items = p.station_id ? hydrated.items.filter((i) => i.stationId === p.station_id) : hydrated.items;
    if (items.length === 0) continue;
    const station = p.station_id ? (stations.find((s) => s.id === p.station_id)?.name ?? p.name) : 'Commande';
    await queue(trx, ctx, p, 'KITCHEN', kitchenTicket(hydrated, items, station, p.width === 32 ? 32 : 48, location.timezone), order.id);
  }
}

export async function printReceipt(ctx: AppContext, scope: TenantScope, paymentId: string): Promise<{ jobs: number }> {
  const receipt = await getReceipt(ctx, scope, paymentId);
  const printers = await ctx.db.selectFrom('printers').selectAll().where('location_id', '=', receipt.payment.locationId).where('status', '=', 'ACTIVE').where('prints_receipts', '=', 1).execute();
  if (printers.length === 0) throw new AppError('CONFLICT', 'Aucune imprimante de reçus : ajoutez-en une dans Menu → Imprimantes.');
  const location = await ctx.db.selectFrom('locations').select('timezone').where('id', '=', receipt.payment.locationId).executeTakeFirstOrThrow();
  await ctx.db.transaction().execute(async (trx) => {
    for (const p of printers) await queue(trx, ctx, p, 'RECEIPT', receiptTicket(receipt, p.width === 32 ? 32 : 48, location.timezone), null);
  });
  return { jobs: printers.length };
}

// --- File ----------------------------------------------------------------------

export async function listPrintJobs(ctx: AppContext, scope: TenantScope, locationId: string): Promise<PrintJob[]> {
  await assertLocation(ctx.db, scope, locationId);
  const rows = await ctx.db
    .selectFrom('print_jobs as j')
    .innerJoin('printers as p', 'p.id', 'j.printer_id')
    .leftJoin('orders as o', 'o.id', 'j.order_id')
    .select(['j.id', 'j.printer_id', 'p.name', 'j.kind', 'j.status', 'j.attempts', 'j.last_error', 'o.number', 'j.created_at', 'j.sent_at'])
    .where('j.location_id', '=', locationId)
    .orderBy('j.created_at', 'desc')
    .limit(50)
    .execute();
  return rows.map((r) => ({ id: r.id, printerId: r.printer_id, printerName: r.name, kind: r.kind, status: r.status, attempts: r.attempts, lastError: r.last_error, orderNumber: r.number, createdAt: r.created_at, sentAt: r.sent_at }));
}

export async function retryPrintJob(ctx: AppContext, scope: TenantScope, jobId: string): Promise<PrintJob> {
  const job = await ctx.db.selectFrom('print_jobs').select(['id', 'location_id', 'tenant_id']).where('id', '=', jobId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
  if (!job || (scope.locationId && job.location_id !== scope.locationId)) throw new AppError('NOT_FOUND', "Travail d'impression introuvable.");
  await ctx.db.updateTable('print_jobs').set({ status: 'PENDING', attempts: 0, last_error: null, next_attempt_at: ctx.now() }).where('id', '=', jobId).execute();
  return (await listPrintJobs(ctx, scope, job.location_id)).find((j) => j.id === jobId)!;
}

/** Un passage de la file : envoie ce qui est dû. Renvoie le nombre de tickets imprimés. */
export async function processPrintJobs(ctx: AppContext): Promise<number> {
  const jobs = await ctx.db
    .selectFrom('print_jobs as j')
    .innerJoin('printers as p', 'p.id', 'j.printer_id')
    .select(['j.id', 'j.payload', 'j.attempts', 'j.printer_id', 'p.host', 'p.port'])
    .where('j.status', '=', 'PENDING')
    .where('j.next_attempt_at', '<=', ctx.now())
    .orderBy('j.created_at')
    .limit(20)
    .execute();
  let sent = 0;
  for (const job of jobs) {
    try {
      await sendToPrinter(job.host, job.port, Buffer.from(job.payload, 'base64'));
      await ctx.db.updateTable('print_jobs').set({ status: 'SENT', sent_at: ctx.now(), last_error: null }).where('id', '=', job.id).execute();
      await ctx.db.updateTable('printers').set({ last_ok_at: ctx.now(), last_error: null }).where('id', '=', job.printer_id).execute();
      sent += 1;
    } catch (err) {
      const attempts = job.attempts + 1;
      const message = (err as Error).message;
      await ctx.db
        .updateTable('print_jobs')
        .set({ attempts, last_error: message, status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', next_attempt_at: ctx.now() + RETRY_DELAY_MS * attempts })
        .where('id', '=', job.id)
        .execute();
      await ctx.db.updateTable('printers').set({ last_error: message }).where('id', '=', job.printer_id).execute();
    }
  }
  return sent;
}

/** Serveur local : la file est vidée en continu. Renvoie la fonction d'arrêt. */
export function startPrintWorker(ctx: AppContext, onError: (err: unknown) => void, everyMs = 1500): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    processPrintJobs(ctx)
      .catch(onError)
      .finally(() => (running = false));
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
