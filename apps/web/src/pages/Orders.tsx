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
import { ORDER_SOURCE_LABELS, orderPlace, sinceText } from '../labels.ts';
import { useProductPhotos } from '../productPhotos.ts';
import { Dialog, FloatMessage, Icon } from '../ui.tsx';

/**
 * Commandes en cours, pour la tablette de salle ou de caisse : une colonne par étape du service.
 * Les appels des tables et les tables à libérer sont DANS la colonne « À traiter » : rien n'apparaît
 * au-dessus des cartes pendant qu'on les touche. En portrait, une colonne à la fois, choisie par onglet.
 */

type ColumnId = 'todo' | 'kitchen' | 'ready' | 'served';

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
  // Vignettes des plats sur les cartes (design v3).
  const photo = useProductPhotos(me.locations[0]?.id ?? null, can('menu.read'));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancel, setCancel] = useState<Order | null>(null);
  const [tab, setTab] = useState<ColumnId | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setNow] = useState(Date.now());

  // Les « il y a 4 min » se mettent à jour seuls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const byAge = (list: Order[]) => list.slice().sort((a, b) => a.createdAt - b.createdAt);
  const requests = feed.requests.slice().sort((a, b) => a.createdAt - b.createdAt);
  // Tables dont toutes les commandes vues sont terminées : proposer de les libérer.
  const freeable = can('orders.create')
    ? [...new Map(feed.closed.filter((o) => o.sessionId && o.status === 'COMPLETED').map((o) => [o.sessionId!, o])).values()].filter((o) => !feed.orders.some((a) => a.sessionId === o.sessionId))
    : [];

  const columns: { id: ColumnId; title: string; orders: Order[]; empty: string }[] = [
    { id: 'todo', title: 'À traiter', orders: byAge(feed.orders.filter((o) => o.status === 'PENDING')), empty: 'Rien à traiter.' },
    { id: 'kitchen', title: 'En cuisine', orders: byAge(feed.orders.filter((o) => o.status === 'CONFIRMED' || o.status === 'PREPARING')), empty: 'Rien en préparation.' },
    { id: 'ready', title: 'Prêtes à servir', orders: byAge(feed.orders.filter((o) => o.status === 'READY')), empty: 'Rien à servir.' },
    { id: 'served', title: 'Servies · à encaisser', orders: byAge(feed.orders.filter((o) => o.status === 'SERVED')), empty: 'Rien à encaisser.' },
  ];
  const countOf = (id: ColumnId) => columns.find((c) => c.id === id)!.orders.length + (id === 'todo' ? requests.length + freeable.length : 0);
  // Onglet d'office : ce qui demande une action d'abord.
  const active = tab ?? (['todo', 'ready', 'kitchen', 'served'] as const).find((id) => countOf(id) > 0) ?? 'todo';
  const selected = feed.orders.find((o) => o.id === selectedId) ?? feed.closed.find((o) => o.id === selectedId) ?? null;

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

  const primaryAction = (order: Order) => allowed(order).find((to) => to !== 'CANCELLED');

  return (
    <section className="page page-orders">
      <header className="page-head">
        <div className="page-title">
          <h1>{t('orders.title')}</h1>
          <p className="page-meta">{feed.online ? `${feed.orders.length} ${t('orders.inProgress')}` : t('status.offline')}</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={feed.refresh}>
            <Icon name="refresh" />
            {t('common.refresh')}
          </button>
        </div>
      </header>

      {!feed.online && <div className="msg msg-warn">{t('orders.offline')}</div>}

      <div className="page-card orders-card">
        <div className="subtabs orders-tabs" role="tablist">
          {columns.map((c) => (
            <button key={c.id} role="tab" aria-current={active === c.id ? 'page' : undefined} onClick={() => setTab(c.id)}>
              {c.title}
              <span className={c.id === 'todo' && countOf(c.id) > 0 ? 'count-pill count-alert' : 'count-pill'}>{countOf(c.id)}</span>
            </button>
          ))}
        </div>

        <div className="board">
          {columns.map((col) => (
            <section key={col.id} className={active === col.id ? `board-col board-${col.id} is-active` : `board-col board-${col.id}`} aria-label={col.title}>
              <header className="board-head">
                <h2>{col.title}</h2>
                <span className={col.id === 'todo' && countOf(col.id) > 0 ? 'count-pill count-alert' : 'count-pill'}>{countOf(col.id)}</span>
              </header>
              <div className="board-list">
                {col.id === 'todo' &&
                  requests.map((r) => (
                    <div className="alert-card" key={r.id}>
                      <div className="alert-text">
                        <strong>
                          {t('qr.colTable')} {r.tableLabel}
                        </strong>
                        <span>
                          {SERVICE_REQUEST_LABELS[r.kind]} · {sinceText(r.createdAt)}
                        </span>
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
                {col.id === 'todo' &&
                  freeable.map((o) => (
                    <div className="alert-card alert-card-ok" key={o.sessionId}>
                      <div className="alert-text">
                        <strong>
                          {t('qr.colTable')} {o.tableLabel}
                        </strong>
                        <span>{t('orders.freeTables')}</span>
                      </div>
                      <button className="btn" onClick={() => freeTable(o)}>
                        {t('orders.freeTable')}
                      </button>
                    </div>
                  ))}
                {!feed.loaded && <p className="board-empty">{t('common.loading')}</p>}
                {feed.loaded && countOf(col.id) === 0 && <p className="board-empty">{col.empty}</p>}
                {col.orders.map((o) => {
                  const next = primaryAction(o);
                  const minutes = Math.floor((Date.now() - o.createdAt) / 60_000);
                  const late = (o.status === 'PENDING' && minutes >= 5) || ((o.status === 'CONFIRMED' || o.status === 'PREPARING') && minutes >= 20);
                  return (
                    <article key={o.id} className="order-card">
                      <button className="order-card-body" onClick={() => setSelectedId(o.id)}>
                        <span className="order-card-top">
                          <span className="order-card-no">n°{o.number}</span>
                          <span className="order-card-where">{orderPlace(o)}</span>
                          <span className={late ? 'order-card-time late' : 'order-card-time'}>{sinceText(o.createdAt)}</span>
                        </span>
                        <span className="order-card-origin">
                          {ORDER_SOURCE_LABELS[o.source]} · {formatMoney(o.total, o.currency)}
                        </span>
                        <span className="order-card-items">
                          {o.items.slice(0, 4).map((i) => {
                            const src = photo(i.productId, i.name);
                            return (
                              <span key={i.id} className="order-card-item">
                                {src ? (
                                  <img className="thumb-xs" src={src} alt="" loading="lazy" />
                                ) : (
                                  <span className="thumb-xs thumb-blank" aria-hidden="true">
                                    <Icon name="kitchen" />
                                  </span>
                                )}
                                <span>
                                  {i.quantity} × {i.name}
                                  {i.variantName && ` (${i.variantName})`}
                                </span>
                              </span>
                            );
                          })}
                          {o.items.length > 4 && <span className="muted">+ {o.items.length - 4} autre(s)</span>}
                        </span>
                      </button>
                      {next && (
                        <button className="btn order-card-action" onClick={() => move(o, next)}>
                          {ACTION_LABELS[next]}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {selected && (
        <Dialog
          title={`${t('orders.order')} n°${selected.number} · ${orderPlace(selected)}`}
          onClose={() => setSelectedId(null)}
          footer={
            <button className="btn" onClick={() => setSelectedId(null)}>
              Fermer
            </button>
          }
        >
          <div className="dialog-body order-detail">
            <p className="muted">
              <span className={STATUS_CLASS[selected.status]}>{ORDER_STATUS_LABELS[selected.status]}</span> · {sinceText(selected.createdAt)} · {ORDER_SOURCE_LABELS[selected.source]}
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
          </div>
        </Dialog>
      )}

      {cancel && (
        <CancelDialog
          order={cancel}
          onClose={() => setCancel(null)}
          onConfirm={async (reason) => {
            await move(cancel, 'CANCELLED', reason);
            setCancel(null);
          }}
        />
      )}

      <FloatMessage
        error={error}
        notice={notice}
        onClose={() => {
          setError(null);
          setNotice(null);
        }}
      />
    </section>
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
          <div className="form">
            <label htmlFor="cancel-reason">{t('orders.reason')}</label>
            <input id="cancel-reason" required maxLength={200} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}
