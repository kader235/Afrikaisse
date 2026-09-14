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
import { Dialog, ErrorMessage, Icon, OkMessage } from '../ui.tsx';

/**
 * Commandes en cours, pour la tablette de salle ou de caisse.
 * Les commandes QR à confirmer passent devant ; les appels des tables sont toujours visibles.
 */

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

  const byAge = (list: Order[]) => list.slice().sort((a, b) => a.createdAt - b.createdAt);
  // Une colonne par étape du service, de gauche à droite.
  const columns: { id: string; title: string; tone: 'wait' | 'cook' | 'ready' | 'served'; orders: Order[]; empty: string }[] = [
    { id: 'pending', title: t('orders.pending'), tone: 'wait', orders: byAge(feed.orders.filter((o) => o.status === 'PENDING')), empty: 'Aucune commande à confirmer.' },
    { id: 'kitchen', title: 'En cuisine', tone: 'cook', orders: byAge(feed.orders.filter((o) => o.status === 'CONFIRMED' || o.status === 'PREPARING')), empty: 'Rien en préparation.' },
    { id: 'ready', title: t('orders.ready'), tone: 'ready', orders: byAge(feed.orders.filter((o) => o.status === 'READY')), empty: 'Rien à servir.' },
    { id: 'served', title: 'Servies · à encaisser', tone: 'served', orders: byAge(feed.orders.filter((o) => o.status === 'SERVED')), empty: 'Rien à encaisser.' },
  ];
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

  const primaryAction = (order: Order) => allowed(order).find((to) => to !== 'CANCELLED');
  const where = (order: Order) => (order.tableLabel ? `${t('qr.colTable')} ${order.tableLabel}` : order.serviceType === 'TAKEAWAY' ? 'À emporter' : 'Comptoir');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('orders.title')}</h1>
          <p className="muted">{feed.online ? `${feed.orders.length} ${t('orders.inProgress')}` : t('status.offline')}</p>
        </div>
        <button className="btn" onClick={feed.refresh}>
          <Icon name="refresh" />
          {t('common.refresh')}
        </button>
      </div>

      {!feed.online && <div className="msg msg-warn">{t('orders.offline')}</div>}
      <ErrorMessage error={error} />
      {notice && !error && <OkMessage>{notice}</OkMessage>}

      {(feed.requests.length > 0 || (freeable.length > 0 && can('orders.create'))) && (
        <div className="alerts-strip">
          {feed.requests
            .slice()
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((r) => (
              <div className="alert-card" key={r.id}>
                <span className="alert-dot" aria-hidden="true" />
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
          {can('orders.create') &&
            freeable.map((o) => (
              <div className="alert-card alert-card-ok" key={o.sessionId}>
                <span className="alert-dot" aria-hidden="true" />
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
        </div>
      )}

      <div className="board">
        {columns.map((col) => (
          <section key={col.id} className={`board-col board-${col.tone}`} aria-label={col.title}>
            <header className="board-head">
              <span className="board-dot" aria-hidden="true" />
              <h2>{col.title}</h2>
              <span className="count-pill">{col.orders.length}</span>
            </header>
            <div className="board-list">
              {!feed.loaded && <p className="board-empty">{t('common.loading')}</p>}
              {feed.loaded && col.orders.length === 0 && <p className="board-empty">{col.empty}</p>}
              {col.orders.map((o) => {
                const next = primaryAction(o);
                const minutes = Math.floor((Date.now() - o.createdAt) / 60_000);
                const late = (o.status === 'PENDING' && minutes >= 5) || ((o.status === 'CONFIRMED' || o.status === 'PREPARING') && minutes >= 20);
                return (
                  <article key={o.id} className="order-card">
                    <button className="order-card-body" onClick={() => setSelectedId(o.id)}>
                      <span className="order-card-top">
                        <span className="order-card-no">{o.number}</span>
                        <span className="order-card-where">{where(o)}</span>
                        <span className={late ? 'order-card-time late' : 'order-card-time'}>{sinceText(o.createdAt)}</span>
                      </span>
                      <span className="order-card-origin">
                        {ORDER_SOURCE_LABELS[o.source]} · {formatMoney(o.total, o.currency)}
                      </span>
                      <span className="order-card-items">
                        {o.items.slice(0, 4).map((i) => (
                          <span key={i.id}>
                            {i.quantity} × {i.name}
                            {i.variantName && ` (${i.variantName})`}
                          </span>
                        ))}
                        {o.items.length > 4 && <span className="muted">+ {o.items.length - 4} autre(s)</span>}
                      </span>
                    </button>
                    {next && (
                      <button className={`btn order-card-action action-${col.tone}`} onClick={() => move(o, next)}>
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

      {selected && (
        <Dialog
          title={`${t('orders.order')} n°${selected.number} · ${where(selected)}`}
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
