import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ORDER_STATUS_LABELS,
  PLAN,
  SERVICE_REQUEST_LABELS,
  TABLE_SHAPES,
  findLayoutIssues,
  formatMoney,
  type AdminMenu,
  type CashSession,
  type Check,
  type DiningTable,
  type Floor,
  type LocationDetails,
  type Me,
  type Order,
  type Receipt,
  type ServiceRequest,
  type TableShape,
  type Zone,
} from '@afrikaisse/core';
import type { ActivityFeed } from '../activity.ts';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { SHAPE_LABELS } from '../labels.ts';
import { isNativeApp } from '../platform.ts';
import { Dialog, ErrorMessage, Icon, OkMessage, Window } from '../ui.tsx';
import { BillTicket, PayDialog, ReceiptTicket, SaleTab, TransferDialog } from './Pos.tsx';

/**
 * Plan de salle, pensé pour la tablette : on touche une table pour la sélectionner ;
 * en mode « Disposer », on la fait glisser au doigt (aimantée aux cases) ou on la
 * pousse case par case avec les flèches. Rien n'est enregistré tant que le plan
 * n'est pas valide ; le serveur revérifie tout.
 */

type Rect = { x: number; y: number; w: number; h: number };
type DialogState =
  | null
  | { kind: 'zone'; zone?: Zone }
  | { kind: 'table'; table?: DiningTable }
  | { kind: 'archiveTable'; table: DiningTable }
  | { kind: 'archiveZone'; zone: Zone };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** État d'une table en service, calculé depuis les notes ouvertes et le flux d'activité. */
type TableLive = {
  state: 'free' | 'occupied' | 'ready' | 'call' | 'settled';
  check: Check | null;
  pending: Order[];
  ready: Order[];
  requests: ServiceRequest[];
  badge: string | null;
};

const minutesSince = (ms: number) => Math.max(0, Math.floor((Date.now() - ms) / 60000));

function nextLabel(tables: DiningTable[]) {
  const numbers = tables.map((x) => /^T(\d+)$/i.exec(x.label)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
  return `T${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

export function FloorPage({ me, feed }: { me: Me; feed?: ActivityFeed }) {
  const { t } = useI18n();
  const canManage = me.permissions.includes('tables.manage');
  const [checks, setChecks] = useState<Check[]>([]);
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [entry, setEntry] = useState<DiningTable | null>(null);
  const [entryError, setEntryError] = useState<unknown>(null);
  const [paying, setPaying] = useState<{ check: Check; drawerOpen: boolean } | null>(null);
  const [transfer, setTransfer] = useState<Check | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [printing, setPrinting] = useState<ReactNode>(null);
  const [, setMinute] = useState(0);
  const [locations, setLocations] = useState<LocationDetails[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Rect>>({});
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<LocationDetails[]>('GET', '/locations').then((list) => {
      setLocations(list);
      setLocationId((current) => current ?? list[0]?.id ?? null);
    }, setError);
  }, []);

  const loadFloor = useCallback(async (id: string) => {
    setError(null);
    try {
      const next = await api<Floor>('GET', `/locations/${id}/floor`);
      setFloor(next);
      setZoneId((current) => (next.zones.some((z) => z.id === current) ? current : (next.zones[0]?.id ?? null)));
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    if (locationId) void loadFloor(locationId);
  }, [locationId, loadFloor]);

  // En service : occupation des tables, relue régulièrement (commandes QR, autres serveurs, caisse).
  const live = !!feed && me.permissions.includes('orders.read');
  const loadChecks = useCallback(async () => {
    if (!locationId || !live) return;
    try {
      setChecks(await api<Check[]>('GET', `/locations/${locationId}/checks`));
    } catch {
      /* le flux d'activité signale déjà la coupure */
    }
  }, [locationId, live]);
  useEffect(() => {
    void loadChecks();
    const poll = setInterval(() => {
      if (!document.hidden) void loadChecks();
    }, 5000);
    const minute = setInterval(() => setMinute((n) => n + 1), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(minute);
    };
  }, [loadChecks]);

  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 150);
    return () => clearTimeout(timer);
  }, [printing]);

  const zone = floor?.zones.find((z) => z.id === zoneId) ?? null;
  const tables = useMemo(() => (floor?.tables ?? []).filter((x) => x.zoneId === zoneId).map((x) => ({ ...x, ...draft[x.id] })), [floor, zoneId, draft]);
  const issues = useMemo(() => (zone ? findLayoutIssues(tables, zone.planWidth, zone.planHeight) : { outOfBounds: [], overlaps: [] }), [tables, zone]);
  const conflicts = useMemo(() => new Set([...issues.outOfBounds, ...issues.overlaps.flat()]), [issues]);
  const dirty = Object.keys(draft).length > 0;
  const selected = tables.find((x) => x.id === selectedId) ?? null;
  const seats = tables.reduce((sum, x) => sum + x.capacity, 0);

  function liveFor(table: DiningTable): TableLive | null {
    if (!feed || !live) return null;
    const check = checks.find((c) => c.kind === 'session' && c.tableId === table.id) ?? null;
    const atTable = feed.orders.filter((o) => o.tableId === table.id);
    const pending = atTable.filter((o) => o.status === 'PENDING');
    const ready = atTable.filter((o) => o.status === 'READY');
    const requests = feed.requests.filter((r) => r.tableId === table.id);
    let state: TableLive['state'] = check || atTable.length > 0 ? (check && check.orders.length > 0 && check.remaining === 0 ? 'settled' : 'occupied') : 'free';
    if (ready.length > 0) state = 'ready';
    if (requests.length > 0 || pending.length > 0) state = 'call';
    const badge = pending.length > 0 ? 'QR' : requests.some((r) => r.kind === 'BILL') ? 'Addition' : requests.length > 0 ? 'Appel' : ready.length > 0 ? 'Prêt' : null;
    return { state, check, pending, ready, requests, badge };
  }

  async function openEntry(table: DiningTable) {
    if (!locationId) return;
    setEntryError(null);
    try {
      // Menu relu à chaque commande : les articles épuisés entre-temps sont à jour.
      setMenu(await api<AdminMenu>('GET', `/locations/${locationId}/menu`));
      setEntry(table);
    } catch (err) {
      setError(err);
    }
  }

  async function moveOrder(order: Order, status: 'CONFIRMED' | 'SERVED') {
    setError(null);
    try {
      const updated = await api<Order>('POST', `/orders/${order.id}/status`, { status });
      feed?.applyOrder(updated);
      setNotice(`Commande n°${order.number} : ${ORDER_STATUS_LABELS[updated.status]}.`);
      void loadChecks();
    } catch (err) {
      setError(err);
    }
  }

  async function resolveRequest(request: ServiceRequest) {
    setError(null);
    try {
      feed?.applyRequest(await api<ServiceRequest>('POST', `/requests/${request.id}/resolve`));
    } catch (err) {
      setError(err);
    }
  }

  async function startPayment(check: Check) {
    setError(null);
    try {
      const { session } = await api<{ session: CashSession | null }>('GET', `/locations/${locationId}/cash-session`);
      setPaying({ check, drawerOpen: !!session });
    } catch (err) {
      setError(err);
    }
  }

  async function freeTable(check: Check) {
    setError(null);
    try {
      await api('POST', `/table-sessions/${check.id}/close`);
      setNotice(`Table ${check.tableLabel} libérée.`);
      void loadChecks();
      feed?.refresh();
    } catch (err) {
      setError(err);
    }
  }

  function place(table: DiningTable, patch: Partial<Rect>) {
    setDraft((d) => ({ ...d, [table.id]: { x: table.x, y: table.y, w: table.w, h: table.h, ...d[table.id], ...patch } }));
  }

  function nudge(dx: number, dy: number) {
    if (!selected || !zone) return;
    place(selected, { x: clamp(selected.x + dx, 0, zone.planWidth - selected.w), y: clamp(selected.y + dy, 0, zone.planHeight - selected.h) });
  }

  function rotate() {
    if (!selected || !zone) return;
    const w = selected.h;
    const h = selected.w;
    place(selected, { w, h, x: clamp(selected.x, 0, zone.planWidth - w), y: clamp(selected.y, 0, zone.planHeight - h) });
  }

  function pick(id: string | null) {
    setSelectedId(id);
    setNotice(null);
  }

  async function saveLayout() {
    if (!zone || !dirty) return;
    setError(null);
    try {
      const updated = await api<DiningTable[]>('PUT', `/zones/${zone.id}/layout`, {
        tables: Object.entries(draft).map(([id, r]) => ({ id, ...r })),
      });
      setFloor((f) => f && { ...f, tables: [...f.tables.filter((x) => x.zoneId !== zone.id), ...updated] });
      setDraft({});
      setEditing(false);
      setNotice(t('floor.layoutSaved'));
    } catch (err) {
      setError(err);
    }
  }

  function cancelLayout() {
    setDraft({});
    setEditing(false);
  }

  async function archive(kind: 'table' | 'zone', id: string) {
    setError(null);
    try {
      if (kind === 'table') {
        await api('POST', `/tables/${id}/archive`);
        setFloor((f) => f && { ...f, tables: f.tables.filter((x) => x.id !== id) });
        setSelectedId(null);
      } else {
        await api('POST', `/zones/${id}/archive`);
        setFloor((f) => {
          if (!f) return f;
          const zones = f.zones.filter((z) => z.id !== id);
          setZoneId(zones[0]?.id ?? null);
          return { ...f, zones };
        });
      }
      setNotice(t('common.saved'));
    } catch (err) {
      setError(err);
    }
    setDialog(null);
  }

  const toolbar = (
    <>
      {locations && locations.length > 1 && (
        <select
          aria-label={t('team.location')}
          value={locationId ?? ''}
          disabled={dirty}
          onChange={(e) => {
            setLocationId(e.target.value);
            pick(null);
          }}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {canManage && !editing && (
        <>
          <button className="btn" disabled={!floor} onClick={() => setDialog({ kind: 'zone' })}>
            <Icon name="add" />
            {t('floor.addZone')}
          </button>
          <button className="btn" disabled={!zone} onClick={() => zone && setDialog({ kind: 'zone', zone })}>
            <Icon name="edit" />
            {t('floor.editZone')}
          </button>
          <button className="btn" disabled={!zone} onClick={() => zone && setDialog({ kind: 'archiveZone', zone })}>
            <Icon name="archive" />
            {t('floor.archiveZone')}
          </button>
          <span className="sep" />
          <button className="btn" disabled={!zone} onClick={() => setDialog({ kind: 'table' })}>
            <Icon name="add" />
            {t('floor.addTable')}
          </button>
          <button className="btn" disabled={!selected} onClick={() => selected && setDialog({ kind: 'table', table: selected })}>
            <Icon name="edit" />
            {t('floor.editTable')}
          </button>
          <button className="btn" disabled={!selected} onClick={() => selected && setDialog({ kind: 'archiveTable', table: selected })}>
            <Icon name="archive" />
            {t('floor.archiveTable')}
          </button>
          <span className="sep" />
          <button className="btn" disabled={tables.length === 0} onClick={() => setEditing(true)}>
            <Icon name="move" />
            {t('floor.arrange')}
          </button>
        </>
      )}
      {editing && (
        <>
          <button className="btn" disabled={!selected} onClick={rotate}>
            <Icon name="rotate" />
            {t('floor.rotate')}
          </button>
          <span className="sep" />
          <button className="btn btn-primary" disabled={!dirty || conflicts.size > 0} onClick={saveLayout}>
            <Icon name="save" />
            {t('floor.saveLayout')}
          </button>
          <button className="btn" onClick={cancelLayout}>
            {t('common.cancel')}
          </button>
        </>
      )}
      {!editing && (
        <>
          <span className="sep" />
          <button className="btn" disabled={!locationId} onClick={() => locationId && loadFloor(locationId)}>
            <Icon name="refresh" />
            {t('common.refresh')}
          </button>
        </>
      )}
    </>
  );

  return (
    <>
      <Window title={floor ? `${t('floor.title')} — ${floor.location.name}` : t('floor.title')} count={zone ? `${tables.length} ${t('floor.tables').toLowerCase()} · ${seats} ${t('floor.seats').toLowerCase()}` : undefined} toolbar={toolbar} bodyless>
        {floor && floor.zones.length > 0 && (
          <div className="subtabs" role="tablist">
            {floor.zones.map((z) => (
              <button
                key={z.id}
                role="tab"
                aria-current={z.id === zoneId ? 'page' : undefined}
                disabled={dirty && z.id !== zoneId}
                onClick={() => {
                  setZoneId(z.id);
                  pick(null);
                }}
              >
                {z.name}
              </button>
            ))}
          </div>
        )}
        <div className="floor">
          <div className="floor-plan">
            {/* Messages au-dessus du plan seulement sans zone : sinon, leur apparition ou
                disparition décale le plan sous le doigt pendant qu'on déplace une table. */}
            {!zone && <ErrorMessage error={error} />}
            {!zone && notice && !error && <OkMessage>{notice}</OkMessage>}
            {locations?.length === 0 && <div className="empty-state">{t('floor.noLocation')}</div>}
            {floor && floor.zones.length === 0 && (
              <div className="empty-state">
                <p>{canManage ? t('floor.noZone') : t('floor.noZoneReadOnly')}</p>
                {canManage && (
                  <button className="btn btn-primary" onClick={() => setDialog({ kind: 'zone' })}>
                    <Icon name="add" />
                    {t('floor.addZone')}
                  </button>
                )}
              </div>
            )}
            {zone && (
              <PlanCanvas
                zone={zone}
                tables={tables}
                selectedId={selectedId}
                editing={editing}
                conflicts={conflicts}
                onSelect={pick}
                onMove={(table, x, y) => place(table, { x, y })}
                onOpen={(table) => canManage && setDialog({ kind: 'table', table })}
                live={editing ? undefined : liveFor}
              />
            )}
            {zone && live && !editing && (
              <div className="plan-legend">
                <span>
                  <i className="l-free" />
                  Libre
                </span>
                <span>
                  <i className="l-occupied" />
                  Occupée
                </span>
                <span>
                  <i className="l-ready" />
                  Commande prête
                </span>
                <span>
                  <i className="l-call" />
                  Appel, addition ou QR à confirmer
                </span>
                <span>
                  <i className="l-settled" />
                  Réglée
                </span>
              </div>
            )}
          </div>

          {zone && (
            <aside className="floor-side">
              <ErrorMessage error={error} />
              {notice && !error && <OkMessage>{notice}</OkMessage>}
              <fieldset className="group">
                <legend>{zone.name}</legend>
                <dl className="facts">
                  <dt>{t('floor.tables')}</dt>
                  <dd className="num">{tables.length}</dd>
                  <dt>{t('floor.seats')}</dt>
                  <dd className="num">{seats}</dd>
                  {live && !editing && (
                    <>
                      <dt>Occupées</dt>
                      <dd className="num">{tables.filter((x) => liveFor(x)?.state !== 'free').length}</dd>
                    </>
                  )}
                  <dt>{t('floor.planSize')}</dt>
                  <dd className="num">
                    {zone.planWidth} × {zone.planHeight}
                  </dd>
                </dl>
              </fieldset>
              {selected && !editing && live ? (
                <ServicePanel
                  table={selected}
                  info={liveFor(selected)!}
                  me={me}
                  onNewOrder={() => openEntry(selected)}
                  onMove={moveOrder}
                  onResolve={resolveRequest}
                  onPay={startPayment}
                  onPrint={isNativeApp() ? null : (check) => setPrinting(<BillTicket check={check} locationName={floor?.location.name ?? ''} />)}
                  onTransfer={setTransfer}
                  onFree={freeTable}
                />
              ) : selected ? (
                <fieldset className="group">
                  <legend>
                    {t('floor.table')} {selected.label}
                  </legend>
                  <dl className="facts">
                    <dt>{t('floor.seats')}</dt>
                    <dd className="num">{selected.capacity}</dd>
                    <dt>{t('floor.shape')}</dt>
                    <dd>{SHAPE_LABELS[selected.shape]}</dd>
                    <dt>{t('floor.position')}</dt>
                    <dd className="num">
                      {selected.x}, {selected.y} ({selected.w} × {selected.h})
                    </dd>
                  </dl>
                  {editing && (
                    <div className="nudge">
                      <span />
                      <button className="btn" aria-label="Haut" onClick={() => nudge(0, -1)}>
                        <Icon name="up" />
                      </button>
                      <span />
                      <button className="btn" aria-label="Gauche" onClick={() => nudge(-1, 0)}>
                        <Icon name="left" />
                      </button>
                      <button className="btn" aria-label={t('floor.rotate')} onClick={rotate}>
                        <Icon name="rotate" />
                      </button>
                      <button className="btn" aria-label="Droite" onClick={() => nudge(1, 0)}>
                        <Icon name="right" />
                      </button>
                      <span />
                      <button className="btn" aria-label="Bas" onClick={() => nudge(0, 1)}>
                        <Icon name="down" />
                      </button>
                      <span />
                    </div>
                  )}
                </fieldset>
              ) : (
                <p className="muted">{editing ? t('floor.hintArrange') : t('floor.hintSelect')}</p>
              )}
              {editing && dirty && conflicts.size === 0 && <div className="msg msg-warn">{t('floor.unsaved')}</div>}
              {conflicts.size > 0 && (
                <div className="msg msg-error">
                  <strong>{t('floor.conflicts')} :</strong> {tables.filter((x) => conflicts.has(x.id)).map((x) => x.label).join(', ')}
                </div>
              )}
            </aside>
          )}
        </div>
      </Window>

      {dialog?.kind === 'zone' && locationId && (
        <ZoneDialog
          locationId={locationId}
          zone={dialog.zone}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setFloor((f) => f && { ...f, zones: f.zones.some((z) => z.id === saved.id) ? f.zones.map((z) => (z.id === saved.id ? saved : z)) : [...f.zones, saved] });
            setZoneId(saved.id);
            setNotice(t('common.saved'));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'table' && zone && floor && (
        <TableDialog
          zone={zone}
          zones={floor.zones}
          table={dialog.table}
          suggestion={nextLabel(floor.tables)}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setFloor((f) => f && { ...f, tables: [...f.tables.filter((x) => x.id !== saved.id), saved] });
            setSelectedId(saved.zoneId === zone.id ? saved.id : null);
            setNotice(t('common.saved'));
            setDialog(null);
          }}
        />
      )}
      {entry && menu && floor && locationId && (
        <div className="entry-overlay" role="dialog" aria-modal="true" aria-label={`Nouvelle commande — Table ${entry.label}`}>
          <div className="entry-head">
            <strong>Nouvelle commande — Table {entry.label}</strong>
            <button className="btn" onClick={() => setEntry(null)}>
              Fermer
            </button>
          </div>
          {!!entryError && (
            <div className="entry-error">
              <ErrorMessage error={entryError} />
            </div>
          )}
          <SaleTab
            locationId={locationId}
            menu={menu}
            floor={floor}
            currency={menu.location.currency}
            canCollect={false}
            fixedTableId={entry.id}
            onSent={(order) => {
              setEntry(null);
              setEntryError(null);
              setError(null);
              setNotice(`Commande n°${order.number} envoyée · table ${entry.label}.`);
              feed?.applyOrder(order);
              void loadChecks();
            }}
            onError={setEntryError}
          />
        </div>
      )}
      {paying && locationId && (
        <PayDialog
          locationId={locationId}
          check={paying.check}
          drawerOpen={paying.drawerOpen}
          onClose={() => setPaying(null)}
          onDone={(r) => {
            setPaying(null);
            setReceipt(r);
            setNotice(`Reçu n°${r.payment.receiptNumber} enregistré.`);
            void loadChecks();
            feed?.refresh();
          }}
        />
      )}
      {transfer && (
        <TransferDialog
          check={transfer}
          floor={floor}
          occupied={new Set(checks.filter((c) => c.kind === 'session').map((c) => c.tableId!))}
          onClose={() => setTransfer(null)}
          onDone={(label, merged) => {
            setTransfer(null);
            setSelectedId(null);
            setNotice(merged ? `Additions regroupées sur la table ${label}.` : `Clients installés à la table ${label}.`);
            void loadChecks();
            feed?.refresh();
          }}
        />
      )}
      {receipt && (
        <Dialog
          title={`Reçu n°${receipt.payment.receiptNumber}`}
          onClose={() => setReceipt(null)}
          footer={
            <>
              {!isNativeApp() && (
                <button className="btn btn-primary" onClick={() => setPrinting(<ReceiptTicket receipt={receipt} />)}>
                  <Icon name="print" />
                  Imprimer
                </button>
              )}
              <button className="btn" onClick={() => setReceipt(null)}>
                Fermer
              </button>
            </>
          }
        >
          <div className="ticket-preview">
            <ReceiptTicket receipt={receipt} />
          </div>
        </Dialog>
      )}
      {printing && createPortal(<div className="print-sheet print-ticket">{printing}</div>, document.body)}
      {(dialog?.kind === 'archiveTable' || dialog?.kind === 'archiveZone') && (
        <Dialog
          title={dialog.kind === 'archiveTable' ? `${t('floor.archiveTable')} — ${dialog.table.label}` : `${t('floor.archiveZone')} — ${dialog.zone.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn btn-primary" onClick={() => (dialog.kind === 'archiveTable' ? archive('table', dialog.table.id) : archive('zone', dialog.zone.id))}>
                {t('loc.archive')}
              </button>
              <button className="btn" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <div className="dialog-body">{dialog.kind === 'archiveTable' ? t('floor.archiveTableConfirm') : t('floor.archiveZoneConfirm')}</div>
        </Dialog>
      )}
    </>
  );
}

function PlanCanvas({
  zone,
  tables,
  selectedId,
  editing,
  conflicts,
  onSelect,
  onMove,
  onOpen,
  live,
}: {
  zone: Zone;
  tables: DiningTable[];
  selectedId: string | null;
  editing: boolean;
  conflicts: Set<string>;
  onSelect: (id: string | null) => void;
  onMove: (table: DiningTable, x: number, y: number) => void;
  onOpen: (table: DiningTable) => void;
  live?: (table: DiningTable) => TableLive | null;
}) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(32);
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);

  // La taille d'une case suit la largeur disponible : le plan occupe toujours l'écran de la tablette.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setCell(clamp(Math.floor((el.clientWidth - 2) / zone.planWidth), 14, 64));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [zone.planWidth]);

  return (
    <div className="plan-wrap" ref={wrapRef}>
      <div
        className={editing ? 'plan editing' : 'plan'}
        style={{ width: cell * zone.planWidth + 2, height: cell * zone.planHeight + 2, backgroundSize: `${cell}px ${cell}px` }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {tables.map((table) => {
          const info = live ? live(table) : null;
          return (
          <button
            key={table.id}
            type="button"
            className={`plan-table shape-${table.shape.toLowerCase()}${conflicts.has(table.id) ? ' conflict' : ''}${info ? ` live-${info.state}` : ''}`}
            aria-pressed={table.id === selectedId}
            style={{
              left: table.x * cell,
              top: table.y * cell,
              width: table.w * cell,
              height: table.h * cell,
              fontSize: clamp(Math.round(cell * 0.42), 11, 18),
            }}
            onPointerDown={(e) => {
              onSelect(table.id);
              if (!editing) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: table.id, startX: e.clientX, startY: e.clientY, x: table.x, y: table.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== table.id) return;
              const x = clamp(d.x + Math.round((e.clientX - d.startX) / cell), 0, zone.planWidth - table.w);
              const y = clamp(d.y + Math.round((e.clientY - d.startY) / cell), 0, zone.planHeight - table.h);
              if (x !== table.x || y !== table.y) onMove(table, x, y);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onDoubleClick={() => !editing && onOpen(table)}
          >
            <strong>{table.label}</strong>
            <span>{info?.check ? `${minutesSince(info.check.openedAt)} min` : `${table.capacity} ${t('floor.seatsShort')}`}</span>
            {info?.badge && <em className="plan-badge">{info.badge}</em>}
          </button>
          );
        })}
      </div>
    </div>
  );
}

const LIVE_LABELS: Record<TableLive['state'], string> = {
  free: 'Libre',
  occupied: 'Occupée',
  ready: 'Commande prête',
  call: 'Demande en attente',
  settled: 'Réglée',
};

/** Fiche d'une table en service : tout ce qu'un serveur fait sans quitter le plan. */
function ServicePanel({
  table,
  info,
  me,
  onNewOrder,
  onMove,
  onResolve,
  onPay,
  onPrint,
  onTransfer,
  onFree,
}: {
  table: DiningTable;
  info: TableLive;
  me: Me;
  onNewOrder: () => void;
  onMove: (order: Order, status: 'CONFIRMED' | 'SERVED') => void;
  onResolve: (request: ServiceRequest) => void;
  onPay: (check: Check) => void;
  onPrint: ((check: Check) => void) | null;
  onTransfer: (check: Check) => void;
  onFree: (check: Check) => void;
}) {
  const has = (p: Me['permissions'][number]) => me.permissions.includes(p);
  const { check } = info;
  return (
    <fieldset className="group service-panel">
      <legend>
        Table {table.label} · {LIVE_LABELS[info.state]}
      </legend>
      <p className="muted">
        {table.capacity} places
        {check && ` · occupée depuis ${minutesSince(check.openedAt)} min`}
      </p>

      {info.requests.map((r) => (
        <div className="service-row service-warn" key={r.id}>
          <span>
            <strong>{SERVICE_REQUEST_LABELS[r.kind]}</strong> <small className="muted">il y a {minutesSince(r.createdAt)} min</small>
          </span>
          {has('orders.create') && (
            <button className="btn" onClick={() => onResolve(r)}>
              Traité
            </button>
          )}
        </div>
      ))}
      {info.pending.map((o) => (
        <div className="service-row service-warn" key={o.id}>
          <span>
            <strong>QR n°{o.number} à confirmer</strong> <small className="muted">{o.items.map((i) => `${i.quantity} ${i.name}`).join(', ')}</small>
          </span>
          {has('orders.create') && (
            <button className="btn btn-primary" onClick={() => onMove(o, 'CONFIRMED')}>
              Confirmer
            </button>
          )}
        </div>
      ))}
      {info.ready.map((o) => (
        <div className="service-row service-ok" key={o.id}>
          <span>
            <strong>n°{o.number} prête</strong> <small className="muted">{o.items.map((i) => `${i.quantity} ${i.name}`).join(', ')}</small>
          </span>
          {has('orders.create') && (
            <button className="btn btn-primary" onClick={() => onMove(o, 'SERVED')}>
              Servie
            </button>
          )}
        </div>
      ))}

      {check && check.orders.length > 0 && (
        <>
          <ul className="order-lines">
            {check.orders.map((o) => (
              <li key={o.id}>
                <div className="order-line-head">
                  <span>
                    n°{o.number} · {ORDER_STATUS_LABELS[o.status]}
                  </span>
                  <span className="num">{formatMoney(o.total, o.currency)}</span>
                </div>
                <div className="muted">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</div>
              </li>
            ))}
          </ul>
          <div className="order-total">
            <span>Total</span>
            <strong>{formatMoney(check.total, check.currency)}</strong>
          </div>
          {check.paid > 0 && (
            <div className="order-line-head">
              <span>Déjà payé</span>
              <span className="num">{formatMoney(check.paid, check.currency)}</span>
            </div>
          )}
          <div className="order-total big">
            <span>Reste à payer</span>
            <strong>{formatMoney(check.remaining, check.currency)}</strong>
          </div>
        </>
      )}

      <div className="order-actions">
        {has('orders.create') && (
          <button className="btn btn-primary" onClick={onNewOrder}>
            <Icon name="add" />
            Nouvelle commande
          </button>
        )}
        {check && check.remaining > 0 && has('payments.collect') && (
          <button className="btn" onClick={() => onPay(check)}>
            Encaisser
          </button>
        )}
        {check && check.orders.length > 0 && onPrint && (
          <button className="btn" onClick={() => onPrint(check)}>
            <Icon name="print" />
            Imprimer l'addition
          </button>
        )}
        {check && has('orders.create') && (
          <button className="btn" onClick={() => onTransfer(check)}>
            Changer de table
          </button>
        )}
        {check && info.state === 'settled' && has('orders.create') && (
          <button className="btn" onClick={() => onFree(check)}>
            Libérer la table
          </button>
        )}
      </div>
    </fieldset>
  );
}

function ZoneDialog({ locationId, zone, onSaved, onClose }: { locationId: string; zone?: Zone; onSaved: (z: Zone) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: zone?.name ?? '', planWidth: zone?.planWidth ?? PLAN.defaultWidth, planHeight: zone?.planHeight ?? PLAN.defaultHeight });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!zone) {
        onSaved(await api<Zone>('POST', `/locations/${locationId}/zones`, form));
        return;
      }
      const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== zone[k as keyof Zone]));
      onSaved(Object.keys(changes).length ? await api<Zone>('PATCH', `/zones/${zone.id}`, changes) : zone);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={zone ? `${t('floor.editZone')} — ${zone.name}` : t('floor.addZone')}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="z-name">{t('floor.zoneName')}</label>
            <input id="z-name" required maxLength={60} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label htmlFor="z-width">{t('floor.planWidth')}</label>
            <input id="z-width" type="number" inputMode="numeric" required min={PLAN.minWidth} max={PLAN.maxWidth} value={form.planWidth} onChange={(e) => setForm({ ...form, planWidth: Number(e.target.value) })} />
            <label htmlFor="z-height">{t('floor.planHeight')}</label>
            <input id="z-height" type="number" inputMode="numeric" required min={PLAN.minHeight} max={PLAN.maxHeight} value={form.planHeight} onChange={(e) => setForm({ ...form, planHeight: Number(e.target.value) })} />
            <span className="hint">{t('floor.planHint')}</span>
          </div>
        </div>
      </Dialog>
    </form>
  );
}

function TableDialog({
  zone,
  zones,
  table,
  suggestion,
  onSaved,
  onClose,
}: {
  zone: Zone;
  zones: Zone[];
  table?: DiningTable;
  suggestion: string;
  onSaved: (t: DiningTable) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    label: table?.label ?? suggestion,
    capacity: table?.capacity ?? 4,
    shape: table?.shape ?? ('SQUARE' as TableShape),
    zoneId: table?.zoneId ?? zone.id,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!table) {
        onSaved(await api<DiningTable>('POST', `/zones/${zone.id}/tables`, { label: form.label, capacity: form.capacity, shape: form.shape }));
        return;
      }
      const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== table[k as keyof DiningTable]));
      onSaved(Object.keys(changes).length ? await api<DiningTable>('PATCH', `/tables/${table.id}`, changes) : table);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={table ? `${t('floor.editTable')} — ${table.label}` : `${t('floor.addTable')} — ${zone.name}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="t-label">{t('floor.label')}</label>
            <input id="t-label" required maxLength={12} autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <label htmlFor="t-capacity">{t('floor.capacity')}</label>
            <input id="t-capacity" type="number" inputMode="numeric" required min={1} max={50} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
            <label htmlFor="t-shape">{t('floor.shape')}</label>
            <select id="t-shape" value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value as TableShape })}>
              {TABLE_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {SHAPE_LABELS[shape]}
                </option>
              ))}
            </select>
            {table && zones.length > 1 && (
              <>
                <label htmlFor="t-zone">{t('floor.zone')}</label>
                <select id="t-zone" value={form.zoneId} onChange={(e) => setForm({ ...form, zoneId: e.target.value })}>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>
      </Dialog>
    </form>
  );
}
