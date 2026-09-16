import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { KITCHEN_PROBLEM_REASONS, ticketDelay, ticketState, type AdminMenu, type KitchenAction, type Me, type Order, type OrderItem, type Station } from '@afrikaisse/core';
import type { ActivityFeed } from '../activity.ts';
import { api } from '../api.ts';
import { orderPlace } from '../labels.ts';
import { useProductPhotos } from '../productPhotos.ts';
import { Dialog, ErrorMessage, FloatMessage, Icon } from '../ui.tsx';
import { useScreenHeartbeat } from '../heartbeat.ts';

/**
 * Écran cuisine (KDS), sombre et lisible à 2 m : trois colonnes, minuteur par ticket (en retard selon
 * le temps de préparation de ses plats), signal à chaque nouveau ticket (alerts.tsx), problème signalé à la salle. Chaque poste ne voit et n'avance que SES articles.
 */

type Column = 'queued' | 'preparing' | 'ready';
const COLUMNS: [Column, string][] = [
  ['queued', 'À préparer'],
  ['preparing', 'En préparation'],
  ['ready', 'Prêt'],
];
const STORAGE_KEY = 'afk.kds.station';
/** Poste changé : les alertes (alerts.tsx) reprennent l'existant du nouveau poste sans sonner. */
export const KDS_STATION_EVENT = 'afk:kds-station';

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

// Au-delà d’une heure : « 1 h 05 » (un « 65:12 » ne se lit pas à 2 m).
const clock = (seconds: number) =>
  seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function KitchenPage({ me, feed }: { me: Me; feed: ActivityFeed }) {
  const locationId = me.locations[0]?.id ?? null;
  const [stations, setStations] = useState<Station[] | null>(null);
  const [stationId, setStationId] = useState(readStored);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prepTimes, setPrepTimes] = useState<Map<string, number | null>>(new Map());
  const [problem, setProblem] = useState<Order | null>(null);
  const [, setTick] = useState(0);
  // Vignettes des plats sur les tickets (design v3) : le cuisinier reconnaît le plat d'un coup d'œil.
  const photo = useProductPhotos(locationId, me.permissions.includes('menu.read'));

  const canUse = (s: Station) => me.permissions.includes(s.kind === 'BAR' ? 'bar.use' : 'kitchen.use');
  const allowed = (stations ?? []).filter(canUse);
  const station = allowed.find((s) => s.id === stationId) ?? null;
  // Supervision (§68) : cet écran se signale tant qu'il est ouvert.
  useScreenHeartbeat(locationId, station?.id ?? null);

  useEffect(() => {
    if (!locationId) return;
    api<Station[]>('GET', `/locations/${locationId}/stations`).then((list) => {
      setStations(list);
      // Cuisinier ou barman : son premier poste est proposé d'office ; un responsable voit tout.
      setStationId((current) => {
        if (list.some((s) => s.id === current)) return current;
        if (me.permissions.includes('kitchen.use') && me.permissions.includes('bar.use')) return '';
        return list.find(canUse)?.id ?? '';
      });
    }, setError);
    // Temps prévu de chaque plat : un ticket passe en retard selon SES plats, pas selon un seuil fixe.
    api<AdminMenu>('GET', `/locations/${locationId}/menu`).then(
      (menu) => setPrepTimes(new Map(menu.products.map((p) => [p.id, p.prepTimeMin]))),
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, stationId);
    } catch {
      /* préférence pour la session seulement */
    }
    window.dispatchEvent(new Event(KDS_STATION_EVENT));
  }, [stationId]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const inScope = (item: OrderItem) => (station ? item.stationId === station.id : !item.stationId || allowed.some((s) => s.id === item.stationId));
  const tickets = feed.orders
    .filter((o) => o.status === 'CONFIRMED' || o.status === 'PREPARING' || o.status === 'READY')
    .map((order) => {
      const items = order.items.filter(inScope);
      return { order, items, state: ticketState(items) };
    })
    .filter((t) => t.items.length > 0)
    .sort((a, b) => a.order.createdAt - b.order.createdAt);

  async function act(order: Order, action: KitchenAction) {
    setBusy(`${order.id}:${action}`);
    setError(null);
    try {
      feed.applyOrder(await api<Order>('POST', `/orders/${order.id}/kitchen`, { stationId: station?.id ?? null, action }));
    } catch (err) {
      setError(err);
      feed.refresh();
    } finally {
      setBusy(null);
    }
  }

  const stationName = (id: string | null) => stations?.find((s) => s.id === id)?.name ?? 'Sans poste';
  const confirmedAt = (o: Order) => o.history.find((h) => h.to === 'CONFIRMED')?.at ?? o.createdAt;
  const fullscreen = () => {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    request?.catch(() => undefined);
  };

  return (
    <section className="kds">
      <div className="kds-bar">
        <strong className="kds-title">Écran cuisine</strong>
        {allowed.length > 1 && (
          <span className="kds-stations" role="group" aria-label="Poste">
            <button className="btn" aria-pressed={!station} onClick={() => setStationId('')}>
              Tous
            </button>
            {allowed.map((s) => (
              <button key={s.id} className="btn" aria-pressed={station?.id === s.id} onClick={() => setStationId(s.id)}>
                {s.name}
              </button>
            ))}
          </span>
        )}
        {!feed.online && <span className="kds-offline">Liaison interrompue — nouvelle tentative…</span>}
        <span className="kds-spacer" />
        <button className="btn" onClick={feed.refresh}>
          <Icon name="refresh" />
          Actualiser
        </button>
        {document.fullscreenEnabled && (
          <button className="btn" onClick={fullscreen}>
            Plein écran
          </button>
        )}
      </div>
      <div className="kds-board">
        {COLUMNS.map(([column, label]) => {
          const list = tickets.filter((t) => t.state === column);
          return (
            <div className="kds-col" key={column}>
              <h2>
                {label}
                <span>{list.length}</span>
              </h2>
              {!feed.loaded && column === 'queued' && <p className="kds-empty">Chargement…</p>}
              {feed.loaded && list.length === 0 && <p className="kds-empty">{column === 'queued' ? 'Rien à préparer.' : '—'}</p>}
              {list.map(({ order, items, state }) => {
                const delay = ticketDelay(confirmedAt(order), items.map((i) => prepTimes.get(i.productId) ?? null), Date.now());
                const age = Math.floor(delay.elapsedMs / 1000);
                const late = state === 'ready' ? '' : delay.level === 2 ? ' kds-late2' : delay.level === 1 ? ' kds-late1' : '';
                const pending = (action: KitchenAction) => busy === `${order.id}:${action}`;
                return (
                  <article key={order.id} className={`kds-card kds-${state}${late}`}>
                    <header>
                      <span className="kds-label">Commande</span>
                      <strong className="kds-num">n°{order.number}</strong>
                      <span>{orderPlace(order)}</span>
                      <span className="kds-timer">{clock(age)}</span>
                    </header>
                    <ul>
                      {items.map((i) => (
                        <li key={i.id} className={i.kdsStatus === 'READY' ? 'kds-item kds-item-ready' : 'kds-item'}>
                          <span className="kds-qty">{i.quantity}</span>
                          {photo(i.productId, i.name) ? (
                            <img className="kds-thumb" src={photo(i.productId, i.name)!} alt="" loading="lazy" />
                          ) : (
                            <span className="kds-thumb kds-thumb-blank" aria-hidden="true" />
                          )}
                          <div>
                            <strong>{i.name}</strong>
                            {i.variantName && <span> · {i.variantName}</span>}
                            {i.modifiers.length > 0 && <div className="kds-mods">{i.modifiers.map((m) => m.name).join(', ')}</div>}
                            {i.note && <div className="kds-note">« {i.note} »</div>}
                            {!station && <div className="kds-station">{stationName(i.stationId)}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {order.note && <div className="kds-note kds-order-note">{order.note}</div>}
                    <footer>
                      {state === 'queued' && (
                        <button className="btn" disabled={!!busy} onClick={() => act(order, 'START')}>
                          {pending('START') ? '…' : 'En préparation'}
                        </button>
                      )}
                      {state !== 'ready' && (
                        <button className="btn btn-primary" disabled={!!busy} onClick={() => act(order, 'READY')}>
                          {pending('READY') ? '…' : 'Prête'}
                        </button>
                      )}
                      {state === 'ready' &&
                        (order.status === 'READY' ? (
                          <span className="kds-announced">Annoncée en salle</span>
                        ) : (
                          <button className="btn" disabled={!!busy} onClick={() => act(order, 'RECALL')}>
                            {pending('RECALL') ? '…' : 'Rappeler'}
                          </button>
                        ))}
                      <button className="btn kds-problem" disabled={!!busy} onClick={() => setProblem(order)}>
                        Signaler un problème
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
      {problem && (
        <ProblemDialog
          order={problem}
          stationId={station?.id ?? null}
          onClose={() => setProblem(null)}
          onSent={() => {
            setProblem(null);
            setError(null);
            setNotice('Salle prévenue');
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

/** « Problème » : motif en un geste, précision facultative ; la salle et la caisse reçoivent une notification. */
function ProblemDialog({ order, stationId, onClose, onSent }: { order: Order; stationId: string | null; onClose: () => void; onSent: () => void }) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const message = [reason, detail.trim()].filter(Boolean).join(' — ');

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/orders/${order.id}/kitchen/problem`, { stationId, message });
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  // Rendue hors de l'écran cuisine : la fenêtre garde l'apparence standard, pas le thème sombre du KDS.
  return createPortal(
    <Dialog
      title={`Problème · commande n°${order.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={busy || !message} onClick={() => void send()}>
            Prévenir la salle
          </button>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
        </>
      }
    >
      <div className="dialog-body">
        <ErrorMessage error={error} />
        <div className="kds-reasons" role="group" aria-label="Motif">
          {KITCHEN_PROBLEM_REASONS.map((r) => (
            <button key={r} type="button" className="btn" aria-pressed={reason === r} onClick={() => setReason(reason === r ? '' : r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="form">
          <label htmlFor="kds-problem-detail">Précision</label>
          <input id="kds-problem-detail" maxLength={150} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </div>
      </div>
    </Dialog>,
    document.body,
  );
}
