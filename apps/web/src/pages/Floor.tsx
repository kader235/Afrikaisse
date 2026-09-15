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
  type CurrencyCode,
  type LocationDetails,
  type Me,
  type OpenTableResult,
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
import { Dialog, ErrorMessage, FloatMessage, Icon, OkMessage, Window } from '../ui.tsx';
import { BillTicket, PayDialog, ReceiptTicket, SaleTab, TransferDialog } from './Pos.tsx';
import { GuestShares, TableCode, requestDetail } from './TableGuests.tsx';

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
  // En service, le plan sert à travailler ; « Aménager » réunit zones, tables et disposition.
  const [mode, setMode] = useState<'service' | 'arrange'>('service');

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
  const arranging = canManage && (!live || mode === 'arrange');
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

  /** Installer des clients avant toute commande : la table s'ouvre et reçoit son code. */
  async function openTable(table: DiningTable) {
    setError(null);
    try {
      const result = await api<OpenTableResult>('POST', `/tables/${table.id}/open`);
      setNotice(result.joinCode ? `Table ${table.label} ouverte · code ${result.joinCode}.` : `Table ${table.label} ouverte.`);
      void loadChecks();
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

  const tools = arranging && (
    <div className="toolbar floor-tools">
      {!editing && (
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
          <button className="btn" disabled={!locationId} onClick={() => locationId && loadFloor(locationId)}>
            <Icon name="refresh" />
            {t('common.refresh')}
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
    </div>
  );

  return (
    <>
      <Window className="page-floor" title={floor ? `${t('floor.title')} — ${floor.location.name}` : t('floor.title')} count={zone ? `${tables.length} ${t('floor.tables').toLowerCase()} · ${seats} ${t('floor.seats').toLowerCase()}` : undefined} bodyless>
        <div className="pos-bar floor-bar">
          {floor && floor.zones.length > 0 ? (
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
          ) : (
            <span />
          )}
          {((locations && locations.length > 1) || (canManage && live)) && (
            <div className="floor-bar-end">
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
              {canManage && live && (
                <span className="segmented" role="group" aria-label="Mode">
                  <button
                    className="btn"
                    aria-pressed={!arranging}
                    disabled={dirty}
                    onClick={() => {
                      setMode('service');
                      setEditing(false);
                      pick(null);
                    }}
                  >
                    Service
                  </button>
                  <button
                    className="btn"
                    aria-pressed={arranging}
                    onClick={() => {
                      setMode('arrange');
                      pick(null);
                    }}
                  >
                    Aménager
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
        {tools}
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
                onOpen={(table) => arranging && setDialog({ kind: 'table', table })}
                live={arranging ? undefined : liveFor}
                crop={!arranging}
              />
            )}
            {zone && live && !arranging && (
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
            <aside className={arranging ? 'floor-side arrange' : 'floor-side'}>
              {!arranging ? (
                selected && live ? (
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
                    codeRequired={!!floor?.location.tableCodeRequired}
                    currency={floor?.location.currency ?? 'XAF'}
                    onOpenTable={() => openTable(selected)}
                    onCodeChanged={(code) => {
                      setNotice(`Table ${selected.label} : nouveau code ${code ?? ''}.`);
                      void loadChecks();
                    }}
                    onError={setError}
                  />
                ) : (
                  <ZoneSummary zone={zone} tables={tables} liveFor={liveFor} onPick={pick} />
                )
              ) : (
                <>
                  <fieldset className="group">
                    <legend>{zone.name}</legend>
                    <dl className="facts">
                      <dt>{t('floor.tables')}</dt>
                      <dd className="num">{tables.length}</dd>
                      <dt>{t('floor.seats')}</dt>
                      <dd className="num">{seats}</dd>
                      <dt>{t('floor.planSize')}</dt>
                      <dd className="num">
                        {zone.planWidth} × {zone.planHeight}
                      </dd>
                    </dl>
                  </fieldset>
                  {selected && (
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
                  )}
                  {editing && dirty && conflicts.size === 0 && <div className="msg msg-warn">{t('floor.unsaved')}</div>}
                  {conflicts.size > 0 && (
                    <div className="msg msg-error">
                      <strong>{t('floor.conflicts')} :</strong> {tables.filter((x) => conflicts.has(x.id)).map((x) => x.label).join(', ')}
                    </div>
                  )}
                </>
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
          <SaleTab
            locationId={locationId}
            menu={menu}
            floor={floor}
            checks={checks}
            currency={menu.location.currency}
            canCollect={false}
            fixedTableId={entry.id}
            error={entryError}
            onDismiss={() => setEntryError(null)}
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
      {!!zone && (
        <FloatMessage
          error={error}
          notice={notice}
          onClose={() => {
            setError(null);
            setNotice(null);
          }}
        />
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
  crop,
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
  /** En service : on ne montre que la partie du plan qui porte des tables, agrandie. */
  crop?: boolean;
}) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(32);
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);

  const view = useMemo(() => {
    if (!crop || tables.length === 0) return { x: 0, y: 0, w: zone.planWidth, h: zone.planHeight };
    const x0 = Math.max(0, Math.min(...tables.map((x) => x.x)) - 1);
    const y0 = Math.max(0, Math.min(...tables.map((x) => x.y)) - 1);
    const x1 = Math.min(zone.planWidth, Math.max(...tables.map((x) => x.x + x.w)) + 1);
    const y1 = Math.min(zone.planHeight, Math.max(...tables.map((x) => x.y + x.h)) + 1);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [crop, tables, zone.planWidth, zone.planHeight]);

  // La taille d'une case suit la place disponible (largeur ET hauteur du cadre) : le plan entier reste visible.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const height = el.clientHeight > 160 ? el.clientHeight - 2 : window.innerHeight * 0.55;
      setCell(clamp(Math.min(Math.floor((el.clientWidth - 2) / view.w), Math.floor(height / view.h)), 14, crop ? 110 : 64));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [view.w, view.h, crop]);

  return (
    <div className="plan-wrap" ref={wrapRef}>
      <div
        className={editing ? 'plan editing' : 'plan'}
        style={{ width: cell * view.w + 2, height: cell * view.h + 2, backgroundSize: `${cell}px ${cell}px` }}
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
              left: (table.x - view.x) * cell,
              top: (table.y - view.y) * cell,
              width: table.w * cell,
              height: table.h * cell,
              fontSize: clamp(Math.round(cell * 0.42), 11, crop ? 20 : 18),
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
            {info && <span className="plan-state">{LIVE_LABELS[info.state]}</span>}
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

const LIVE_DOT: Record<TableLive['state'], string> = {
  free: 'st',
  occupied: 'st st-progress',
  ready: 'st st-ready',
  call: 'st st-pending',
  settled: 'st st-served',
};

/** Fiche d'une table en service : tout ce qu'un serveur fait sans quitter le plan ; les boutons restent en bas. */
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
  codeRequired,
  currency,
  onOpenTable,
  onCodeChanged,
  onError,
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
  /** Établissement à code de table (I-9). */
  codeRequired: boolean;
  currency: CurrencyCode;
  onOpenTable: () => void;
  onCodeChanged: (code: string | null) => void;
  onError: (err: unknown) => void;
}) {
  const has = (p: Me['permissions'][number]) => me.permissions.includes(p);
  const { check } = info;
  const hasOrders = !!check && check.orders.length > 0;
  const quiet = info.requests.length === 0 && info.pending.length === 0 && info.ready.length === 0 && !hasOrders;
  const canPay = !!check && check.remaining > 0 && has('payments.collect');
  const canPrint = hasOrders && !!onPrint;

  return (
    <div className="check-detail service-panel">
      <div className="check-detail-head">
        <strong>Table {table.label}</strong>
        <span className="muted">
          <span className={LIVE_DOT[info.state]}>{LIVE_LABELS[info.state]}</span> · {table.capacity} places
          {check && ` · depuis ${minutesSince(check.openedAt)} min`}
        </span>
        {codeRequired && check && <TableCode check={check} canManage={has('orders.create')} onChanged={onCodeChanged} onError={onError} />}
      </div>

      <div className="check-detail-body">
        {info.requests.map((r) => (
          <div className="alert-card" key={r.id}>
            <div className="alert-text">
              <strong>{SERVICE_REQUEST_LABELS[r.kind]}</strong>
              <span>il y a {minutesSince(r.createdAt)} min</span>
              {requestDetail(r, currency) && <span className="request-detail">{requestDetail(r, currency)}</span>}
            </div>
            {has('orders.create') && (
              <button className="btn" onClick={() => onResolve(r)}>
                Traité
              </button>
            )}
          </div>
        ))}
        {info.pending.map((o) => (
          <div className="alert-card" key={o.id}>
            <div className="alert-text">
              <strong>QR n°{o.number} à confirmer</strong>
              <span>{o.items.map((i) => `${i.quantity} ${i.name}`).join(', ')}</span>
            </div>
            {has('orders.create') && (
              <button className="btn" onClick={() => onMove(o, 'CONFIRMED')}>
                Confirmer
              </button>
            )}
          </div>
        ))}
        {info.ready.map((o) => (
          <div className="alert-card alert-card-ok" key={o.id}>
            <div className="alert-text">
              <strong>n°{o.number} prête</strong>
              <span>{o.items.map((i) => `${i.quantity} ${i.name}`).join(', ')}</span>
            </div>
            {has('orders.create') && (
              <button className="btn" onClick={() => onMove(o, 'SERVED')}>
                Servie
              </button>
            )}
          </div>
        ))}
        {hasOrders && (
          <ul className="order-lines">
            {check!.orders.map((o) => (
              <li key={o.id}>
                <div className="order-line-head">
                  <span>
                    n°{o.number}
                    {o.guestName && <span className="guest-name"> · {o.guestName}</span>} · {ORDER_STATUS_LABELS[o.status]}
                  </span>
                  <span className="num">{formatMoney(o.total, o.currency)}</span>
                </div>
                <div className="muted">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</div>
              </li>
            ))}
          </ul>
        )}
        {quiet && <p className="muted">Aucune commande.</p>}
      </div>

      <div className="check-detail-foot">
        {hasOrders && (
          <>
            <GuestShares check={check!} />
            <div className="order-line-head">
              <span>Total</span>
              <span className="num">{formatMoney(check!.total, check!.currency)}</span>
            </div>
            {check!.paid > 0 && (
              <div className="order-line-head">
                <span>Déjà payé</span>
                <span className="num">{formatMoney(check!.paid, check!.currency)}</span>
              </div>
            )}
            <div className="check-due">
              <span>Reste à payer</span>
              <strong>{formatMoney(check!.remaining, check!.currency)}</strong>
            </div>
          </>
        )}
        <div className="check-actions">
          {has('orders.create') && (
            <button className="btn btn-primary" onClick={onNewOrder}>
              <Icon name="add" />
              Nouvelle commande
            </button>
          )}
          {!check && codeRequired && has('orders.create') && (
            <button className="btn" onClick={onOpenTable}>
              Ouvrir la table
            </button>
          )}
          {(canPay || canPrint) && (
            <div className="check-actions-row">
              {canPay && (
                <button className="btn" onClick={() => onPay(check!)}>
                  <Icon name="cash" />
                  Encaisser
                </button>
              )}
              {canPrint && (
                <button className="btn" onClick={() => onPrint!(check!)}>
                  <Icon name="print" />
                  Addition
                </button>
              )}
            </div>
          )}
          {check && has('orders.create') && (
            <div className="check-actions-row">
              <button className="btn" onClick={() => onTransfer(check)}>
                <Icon name="move" />
                Changer de table
              </button>
              {(info.state === 'settled' || (check.orders.length === 0 && info.pending.length === 0)) && (
                <button className="btn" onClick={() => onFree(check)}>
                  Libérer
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Sans table choisie : l'état de la zone et les tables qui attendent quelque chose. */
function ZoneSummary({ zone, tables, liveFor, onPick }: { zone: Zone; tables: DiningTable[]; liveFor: (table: DiningTable) => TableLive | null; onPick: (id: string) => void }) {
  const rows = tables.map((table) => ({ table, info: liveFor(table) }));
  const inState = (states: TableLive['state'][]) => rows.filter((r) => r.info && states.includes(r.info.state)).length;
  const waiting = rows.filter((r) => r.info && r.info.state !== 'free' && r.info.state !== 'occupied').sort((a, b) => a.table.label.localeCompare(b.table.label, 'fr', { numeric: true }));
  const live = rows.some((r) => r.info);
  const seats = tables.reduce((sum, x) => sum + x.capacity, 0);
  const todo = inState(['call', 'ready']);
  const reason = (info: TableLive) => (info.state === 'ready' ? 'Commande prête à servir' : info.state === 'settled' ? 'Réglée · à libérer' : info.badge === 'QR' ? 'Commande QR à confirmer' : info.badge === 'Addition' ? "Demande l'addition" : 'Appel');

  return (
    <div className="check-detail floor-summary">
      <div className="check-detail-head">
        <strong>{zone.name}</strong>
        <span className="muted">
          {tables.length} tables · {seats} places
        </span>
      </div>
      <div className="check-detail-body">
        {live && (
          <dl className="summary-counts">
            <div>
              <dt>Libres</dt>
              <dd>{inState(['free'])}</dd>
            </div>
            <div>
              <dt>Occupées</dt>
              <dd>{inState(['occupied', 'ready', 'call', 'settled'])}</dd>
            </div>
            <div>
              <dt>À traiter</dt>
              <dd className={todo > 0 ? 'alert' : undefined}>{todo}</dd>
            </div>
          </dl>
        )}
        {waiting.map(({ table, info }) => (
          <button key={table.id} className={info!.state === 'settled' ? 'alert-card alert-card-ok floor-alert' : 'alert-card floor-alert'} onClick={() => onPick(table.id)}>
            <span className="alert-text">
              <strong>Table {table.label}</strong>
              <span>{reason(info!)}</span>
            </span>
            <Icon name="chevronRight" />
          </button>
        ))}
      </div>
    </div>
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
