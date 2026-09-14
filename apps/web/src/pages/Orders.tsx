import { useEffect, useState } from 'react';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_REQUEST_LABELS,
  formatMoney,
  nextStatuses,
  permissionsForTransition,
  type Me,
  type Order,
  type OrderStatus,
} from '@afrikaisse/core';
import type { ActivityFeed } from '../activity.ts';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ORDER_SOURCE_LABELS, sinceText } from '../labels.ts';
import { Dialog, ErrorMessage, Icon, OkMessage, Window } from '../ui.tsx';

/**
 * Commandes en cours, pour la tablette de salle ou de caisse.
 * Les commandes QR à confirmer passent devant ; les appels des tables sont toujours visibles.
 */
type Filter = 'pending' | 'active' | 'ready';

const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'Confirmer',
  PREPARING: 'En préparation',
  READY: 'Prête',
  SERVED: 'Servie',
  COMPLETED: 'Terminer',
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  PENDING: 'st st-pending',
  CONFIRMED: 'st st-progress',
  PREPARING: 'st st-progress',
  READY: 'st st-ready',
  SERVED: 'st st-served',
  COMPLETED: 'st st-served',
  CANCELLED: 'st st-cancelled',
};

export function OrdersPage({ me, feed }: { me: Me; feed: ActivityFeed }) {
  const { t } = useI18n();
  const can = (p: Me['permissions'][number]) => me.permissions.includes(p);
  const [filter, setFilter] = useState<Filter>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancel, setCancel] = useState<Order | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setNow] = useState(Date.now());

  // Les « il y a 4 min » se mettent à jour seuls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const pending = feed.orders.filter((o) => o.status === 'PENDING');
  const ready = feed.orders.filter((o) => o.status === 'READY');
  const visible = (filter === 'pending' ? pending : filter === 'ready' ? ready : feed.orders).slice().sort((a, b) => a.createdAt - b.createdAt);
  const selected = feed.orders.find((o) => o.id === selectedId) ?? feed.closed.find((o) => o.id === selectedId) ?? null;

  // Filtre « À confirmer » vide : on montre les commandes en cours plutôt qu'un écran vide.
  useEffect(() => {
    if (feed.loaded && filter === 'pending' && pending.length === 0 && feed.orders.length > 0) setFilter('active');
  }, [feed.loaded, filter, pending.length, feed.orders.length]);

  // « Terminer » n'apparaît qu'une fois la commande encaissée (sinon le serveur refuserait).
  const allowed = (order: Order) =>
    nextStatuses(order.status).filter((to) => (to !== 'COMPLETED' || order.paymentStatus === 'PAID') && permissionsForTransition(order.status, to).some((p) => can(p)));

  async function move(order: Order, to: OrderStatus, reason?: string) {
    setError(null);
    setNotice(null);
    try {
      const updated = await api<Order>('POST', `/orders/${order.id}/status`, { status: to, ...(reason && { reason }) });
      feed.applyOrder(updated);
      setNotice(`Commande n°${order.number} : ${ORDER_STATUS_LABELS[to]}.`);
    } catch (err) {
      setError(err);
      feed.refresh();
    }
  }

  // Tables dont toutes les commandes vues sont terminées : proposer de les libérer.
  const freeable = [...new Map(feed.closed.filter((o) => o.sessionId && o.status === 'COMPLETED').map((o) => [o.sessionId!, o])).values()].filter(
    (o) => !feed.orders.some((a) => a.sessionId === o.sessionId),
  );

  async function freeTable(order: Order) {
    setError(null);
    try {
      await api('POST', `/table-sessions/${order.sessionId}/close`);
      setNotice(`Table ${order.tableLabel} libérée.`);
      feed.refresh();
    } catch (err) {
      setError(err);
    }
  }

  const filters: [Filter, string, number][] = [
    ['pending', t('orders.pending'), pending.length],
    ['active', t('orders.active'), feed.orders.length],
    ['ready', t('orders.ready'), ready.length],
  ];

  return (
    <>
      <Window
        title={t('orders.title')}
        count={feed.online ? `${feed.orders.length} ${t('orders.inProgress')}` : t('status.offline')}
        bodyless
        toolbar={
          <>
            <span className="segmented">
              {filters.map(([id, label, n]) => (
                <button key={id} className="btn" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                  <span className="count-pill">{n}</span>
                </button>
              ))}
            </span>
            <span className="sep" />
            <button className="btn" onClick={feed.refresh}>
              <Icon name="refresh" />
              {t('common.refresh')}
            </button>
          </>
        }
      >
        {(!!error || notice || !feed.online) && (
          <div className="window-body" style={{ paddingBottom: 0 }}>
            {!feed.online && <div className="msg msg-warn">{t('orders.offline')}</div>}
            <ErrorMessage error={error} />
            {notice && !error && <OkMessage>{notice}</OkMessage>}
          </div>
        )}

        <div className="floor">
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>{t('qr.colTable')}</th>
                  <th>{t('orders.since')}</th>
                  <th>{t('orders.items')}</th>
                  <th>{t('menu.colPrice')}</th>
                  <th>{t('team.status')}</th>
                  <th>{t('orders.source')}</th>
                </tr>
              </thead>
              <tbody>
                {!feed.loaded && (
                  <tr>
                    <td className="empty" colSpan={7}>
                      {t('common.loading')}
                    </td>
                  </tr>
                )}
                {feed.loaded && visible.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={7}>
                      {filter === 'pending' ? t('orders.nonePending') : t('orders.none')}
                    </td>
                  </tr>
                )}
                {visible.map((o) => (
                  <tr key={o.id} className="selectable" aria-selected={o.id === selectedId} onClick={() => setSelectedId(o.id)}>
                    <td className="num">
                      <strong>{o.number}</strong>
                    </td>
                    <td>{o.tableLabel ?? '—'}</td>
                    <td className="num">{sinceText(o.createdAt)}</td>
                    <td className="num">{o.itemCount}</td>
                    <td className="num">{formatMoney(o.total, o.currency)}</td>
                    <td>
                      <span className={STATUS_CLASS[o.status]}>{ORDER_STATUS_LABELS[o.status]}</span>
                    </td>
                    <td>{ORDER_SOURCE_LABELS[o.source]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="floor-side">
            {feed.requests.length > 0 && (
              <fieldset className="group requests">
                <legend>{t('orders.requests')}</legend>
                {feed.requests
                  .slice()
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map((r) => (
                    <div className="request-row" key={r.id}>
                      <div>
                        <strong>
                          {t('qr.colTable')} {r.tableLabel}
                        </strong>
                        <div className="muted">
                          {SERVICE_REQUEST_LABELS[r.kind]} · {sinceText(r.createdAt)}
                        </div>
                      </div>
                      {can('orders.create') && (
                        <button
                          className="btn"
                          onClick={async () => {
                            try {
                              feed.applyRequest(await api('POST', `/requests/${r.id}/resolve`));
                            } catch (err) {
                              setError(err);
                            }
                          }}
                        >
                          {t('orders.handled')}
                        </button>
                      )}
                    </div>
                  ))}
              </fieldset>
            )}

            {freeable.length > 0 && can('orders.create') && (
              <fieldset className="group">
                <legend>{t('orders.freeTables')}</legend>
                {freeable.map((o) => (
                  <div className="request-row" key={o.sessionId}>
                    <strong>
                      {t('qr.colTable')} {o.tableLabel}
                    </strong>
                    <button className="btn" onClick={() => freeTable(o)}>
                      {t('orders.freeTable')}
                    </button>
                  </div>
                ))}
              </fieldset>
            )}

            {selected ? (
              <fieldset className="group order-detail">
                <legend>
                  {t('orders.order')} n°{selected.number}
                  {selected.tableLabel && ` · ${t('qr.colTable')} ${selected.tableLabel}`}
                </legend>
                <p className="muted">
                  <span className={STATUS_CLASS[selected.status]}>{ORDER_STATUS_LABELS[selected.status]}</span> · {sinceText(selected.createdAt)}
                </p>
                <ul className="order-lines">
                  {selected.items.map((i) => (
                    <li key={i.id}>
                      <div className="order-line-head">
                        <strong>
                          {i.quantity} × {i.name}
                          {i.variantName && ` (${i.variantName})`}
                        </strong>
                        <span className="num">{formatMoney(i.total, selected.currency)}</span>
                      </div>
                      {i.modifiers.length > 0 && <div className="muted">{i.modifiers.map((m) => m.name).join(', ')}</div>}
                      {i.note && <div className="order-note">« {i.note} »</div>}
                    </li>
                  ))}
                </ul>
                {selected.note && <div className="msg msg-warn">{selected.note}</div>}
                <div className="order-total">
                  <span>{t('orders.total')}</span>
                  <strong>{formatMoney(selected.total, selected.currency)}</strong>
                </div>
                <p className="muted" style={{ marginBottom: 8 }}>
                  {PAYMENT_STATUS_LABELS[selected.paymentStatus]}
                  {selected.paid > 0 && selected.paymentStatus !== 'PAID' && ` · ${formatMoney(selected.paid, selected.currency)} payés`}
                  {selected.discount > 0 && ` · remise ${formatMoney(selected.discount, selected.currency)}`}
                </p>
                <div className="order-actions">
                  {allowed(selected)
                    .filter((to) => to !== 'CANCELLED')
                    .map((to, index) => (
                      <button key={to} className={index === 0 ? 'btn btn-primary' : 'btn'} onClick={() => move(selected, to)}>
                        {ACTION_LABELS[to]}
                      </button>
                    ))}
                  {allowed(selected).includes('CANCELLED') && (
                    <button className="btn btn-danger" onClick={() => (selected.status === 'PENDING' ? move(selected, 'CANCELLED') : setCancel(selected))}>
                      {selected.status === 'PENDING' ? t('orders.reject') : t('orders.cancel')}
                    </button>
                  )}
                </div>
                <details className="order-history">
                  <summary>{t('orders.history')}</summary>
                  <ul>
                    {selected.history.map((h, i) => (
                      <li key={i}>
                        {new Date(h.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} — {ORDER_STATUS_LABELS[h.to]}
                        {h.by && ` · ${h.by}`}
                        {h.reason && ` · « ${h.reason} »`}
                      </li>
                    ))}
                  </ul>
                </details>
              </fieldset>
            ) : (
              <p className="muted">{t('orders.selectHint')}</p>
            )}
          </aside>
        </div>
      </Window>

      {cancel && <CancelDialog order={cancel} onClose={() => setCancel(null)} onConfirm={async (reason) => { await move(cancel, 'CANCELLED', reason); setCancel(null); }} />}
    </>
  );
}

function CancelDialog({ order, onConfirm, onClose }: { order: Order; onConfirm: (reason: string) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onConfirm(reason);
      }}
    >
      <Dialog
        title={`${t('orders.cancel')} — n°${order.number}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary">{t('orders.cancel')}</button>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <p className="muted" style={{ marginBottom: 10 }}>
            {t('orders.cancelHint')}
          </p>
          <div className="form">
            <label htmlFor="cancel-reason">{t('orders.reason')}</label>
            <input id="cancel-reason" required maxLength={200} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}
