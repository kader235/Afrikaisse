import { useCallback, useEffect, useState } from 'react';
import { ORDER_STATUS_LABELS, businessDate, formatDuration, formatMoney, moneyToInput, shiftDate, type KitchenReport, type LocationDetails, type Me, type Order, type SalesReport } from '@afrikaisse/core';
import type { ActivityFeed } from '../activity.ts';
import { api } from '../api.ts';
import { orderPlace, sinceText } from '../labels.ts';
import { mediaSrc } from '../platform.ts';
import { useProductPhotos } from '../productPhotos.ts';
import { ServiceHeader } from '../serviceHeader.tsx';
import { ErrorMessage, Icon } from '../ui.tsx';
import '../styles/reports.css';

/**
 * Tableau de bord (design v3) : ce qui se passe aujourd'hui dans l'établissement.
 * 1. les chiffres clés en cartes (le chiffre d'affaires en carte dégradée), comparés à hier ;
 * 2. les ventes heure par heure et les commandes en direct (flux d'activité) ;
 * 3. le service en cours (compteurs qui ouvrent l'écran concerné) et les plats les plus vendus, en photo.
 * L'analyse d'une période est dans Rapports. Même écran à la tablette et au PC ; il défile s'il le faut.
 */

export type DashboardTarget = 'orders' | 'kitchen' | 'floor' | 'stock' | 'pos' | 'reports' | 'take';

const STATUS_CLASS: Partial<Record<Order['status'], string>> = {
  PENDING: 'st st-pending',
  CONFIRMED: 'st st-progress',
  PREPARING: 'st st-progress',
  READY: 'st st-ready',
  SERVED: 'st st-served',
};

/** Écart avec hier, en pourcentage ; rien quand hier est vide (un « +∞ % » n'apprend rien). */
function change(now: number, before: number): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  if (before === 0) return null;
  const pct = Math.round(((now - before) * 1000) / before) / 10;
  if (pct === 0) return { text: 'Comme hier à la même heure', tone: 'flat' };
  return { text: `${pct > 0 ? '+' : '−'} ${Math.abs(pct).toLocaleString('fr-FR')} % par rapport à hier`, tone: pct > 0 ? 'up' : 'down' };
}

export function DashboardPage({ me, feed, onNavigate }: { me: Me; feed?: ActivityFeed; onNavigate: (target: DashboardTarget) => void }) {
  const can = (p: Me['permissions'][number]) => me.permissions.includes(p);
  const canTables = can('tables.read');
  const canStock = can('inventory.read');
  const [locations, setLocations] = useState<LocationDetails[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [today, setToday] = useState<SalesReport | null>(null);
  const [yesterday, setYesterday] = useState<SalesReport | null>(null);
  const [kitchen, setKitchen] = useState<KitchenReport | null>(null);
  const [tablesTotal, setTablesTotal] = useState<number | null>(null);
  const [lowStock, setLowStock] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const photo = useProductPhotos(locationId, can('menu.read'));

  useEffect(() => {
    api<LocationDetails[]>('GET', '/locations').then((list) => {
      setLocations(list);
      setLocationId((current) => current ?? list[0]?.id ?? null);
    }, setError);
  }, []);

  const location = locations?.find((l) => l.id === locationId) ?? null;
  const day = location ? businessDate(Date.now(), location.timezone, location.businessDayCutoffMin) : null;

  const load = useCallback(async () => {
    if (!locationId || !day) return;
    const url = (d: string) => `/locations/${locationId}/reports/sales?from=${d}&to=${d}`;
    try {
      const [current, before, prep] = await Promise.all([
        api<SalesReport>('GET', url(day)),
        api<SalesReport>('GET', url(shiftDate(day, -1))).catch(() => null),
        api<KitchenReport>('GET', `/locations/${locationId}/reports/kitchen?from=${day}&to=${day}`).catch(() => null),
      ]);
      setToday(current);
      setYesterday(before);
      setKitchen(prep);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [locationId, day]);

  // Les ventes du jour se relisent chaque minute ; le flux d'activité, lui, suit les commandes en direct.
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!locationId) return;
    if (canTables) api<{ tables: unknown[] }>('GET', `/locations/${locationId}/floor`).then((f) => setTablesTotal(f.tables.length), () => setTablesTotal(null));
    if (canStock) api<{ name: string; state: string }[]>('GET', `/locations/${locationId}/inventory`).then((list) => setLowStock(list.filter((i) => i.state !== 'OK').map((i) => i.name)), () => setLowStock(null));
  }, [locationId, canTables, canStock]);

  const orders = feed?.orders ?? [];
  const count = (...statuses: Order['status'][]) => orders.filter((o) => statuses.includes(o.status)).length;
  const occupied = new Set(orders.map((o) => o.tableId).filter(Boolean)).size;
  const money = (v: number) => (today ? formatMoney(v, today.currency) : '—');
  const t = today?.totals;
  // Hier jusqu'à la même heure de la journée d'exploitation : comparer une journée entière à une journée
  // commencée afficherait « ▼ 100 % » chaque matin.
  const hourNow = new Date().getHours();
  const cutoffHour = location ? Math.floor(location.businessDayCutoffMin / 60) : 0;
  const rank = (hour: number) => (hour - cutoffHour + 24) % 24;
  const sameTime = yesterday?.byHour.filter((h) => rank(h.hour) <= rank(hourNow)) ?? null;
  const yRevenue = sameTime?.reduce((n, h) => n + h.revenue, 0) ?? 0;
  const yOrders = sameTime?.reduce((n, h) => n + h.orders, 0) ?? 0;
  const y = sameTime ? { revenue: yRevenue, orders: yOrders, averageTicket: yOrders > 0 ? Math.round(yRevenue / yOrders) : 0 } : null;
  const latest = [...orders].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const heroPhoto = today?.topProducts.map((p) => photo(null, p.name)).find((x) => x) ?? null;
  const logo = location?.logoUrl ? mediaSrc(location.logoUrl) : heroPhoto;
  const revenueChange = t && y ? change(t.revenue, y.revenue) : null;
  const ordersChange = t && y ? change(t.orders, y.orders) : null;
  const kitchenOk = !!kitchen && kitchen.totals.measured > 0;
  const inKitchen = count('CONFIRMED', 'PREPARING');
  return (
    <section className="dash">
      <ServiceHeader userName={me.user.displayName} restaurantName={location?.name ?? me.tenant?.name ?? 'AfriKaisse'} logo={logo} restaurantOnly>
        {locations && locations.length > 1 && (
          <select aria-label="Établissement" value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {can('reports.read') && (
          <button className="btn" onClick={() => onNavigate('reports')}>
            <Icon name="chart" />
            Rapports
          </button>
        )}
        {(can('orders.create') || can('pos.use')) && (
          <button className="btn btn-primary" onClick={() => onNavigate(can('orders.create') && canTables ? 'take' : 'pos')}>
            <Icon name="add" />
            Nouvelle commande
          </button>
        )}
      </ServiceHeader>

      <ErrorMessage error={error} />

      <div className="kpis" aria-label="Aujourd'hui">
        <div className="kpi kpi-hero">
          {heroPhoto && <img src={heroPhoto} alt="" />}
          <small>
            <Icon name="cash" />
            Chiffre d'affaires du jour
          </small>
          <strong>{t ? money(t.revenue) : '—'}</strong>
          <span>{revenueChange ? revenueChange.text : t ? `Panier moyen ${money(t.averageTicket)}` : 'Chargement…'}</span>
        </div>
        <div className="kpi">
          <small>
            <Icon name="ticket" />
            Commandes
          </small>
          <strong>{t ? String(t.orders) : '—'}</strong>
          <span className={ordersChange ? `kpi-${ordersChange.tone}` : ''}>{ordersChange ? ordersChange.text : t ? `Panier moyen ${money(t.averageTicket)}` : ''}</span>
        </div>
        {tablesTotal !== null ? (
          <div className="kpi">
            <small>
              <Icon name="table" />
              Tables occupées
            </small>
            <strong>
              {occupied} / {tablesTotal}
            </strong>
            <span>{tablesTotal > 0 ? `${Math.round((occupied * 100) / tablesTotal)} % de la salle` : 'Aucune table'}</span>
          </div>
        ) : (
          <div className="kpi">
            <small>
              <Icon name="cash" />
              Panier moyen
            </small>
            <strong>{t ? money(t.averageTicket) : '—'}</strong>
            <span>{t ? `${t.orders} commande${t.orders > 1 ? 's' : ''}` : ''}</span>
          </div>
        )}
        <div className="kpi">
          <small>
            <Icon name="clock" />
            Temps cuisine
          </small>
          <strong>{kitchenOk ? formatDuration(kitchen.totals.averageMs) : '—'}</strong>
          <span className={kitchenOk && kitchen.totals.lateCount > 0 ? 'kpi-down' : ''}>{kitchenOk ? (kitchen.totals.lateCount > 0 ? `${kitchen.totals.lateCount} en retard` : 'Aucun retard') : 'Aucune commande prête'}</span>
        </div>
      </div>

      <div className="dash-cols">
        <div className="dash-col">
          <section className="card">
            <h3>
              Ventes par heure
              {can('reports.read') && (
                <button type="button" className="btn btn-dashboard" onClick={() => onNavigate('reports')}>
                  Rapports
                </button>
              )}
            </h3>
            {today ? <HourChart today={today} yesterday={yesterday} cutoffHour={cutoffHour} /> : <p className="muted">Chargement…</p>}
          </section>

          {feed && (
            <section className="card">
              <h3>
                <span className="card-title">
                  Commandes en direct
                  <span className={feed.online ? 'live-pill' : 'live-pill off'}>
                    <i aria-hidden="true" />
                    {feed.online ? 'En direct' : 'Hors ligne'}
                  </span>
                </span>
                <button type="button" className="btn btn-dashboard" onClick={() => onNavigate('orders')}>
                  Toutes
                </button>
              </h3>
              {latest.length === 0 ? (
                <p className="card-empty">{feed.loaded ? 'Aucune commande en cours' : 'Chargement…'}</p>
              ) : (
                <ul className="live-list">
                  {latest.map((o) => {
                    const items = o.items.reduce((n, i) => n + i.quantity, 0);
                    const first = o.items[0];
                    const thumb = first ? photo(first.productId, first.name) : null;
                    return (
                      <li key={o.id}>
                        <button type="button" className="live-row" onClick={() => onNavigate('orders')}>
                          {thumb ? (
                            <img className="thumb-sm" src={thumb} alt="" />
                          ) : (
                            <span className="thumb-sm thumb-blank" aria-hidden="true">
                              <Icon name="kitchen" />
                            </span>
                          )}
                          <span className="live-text">
                            <strong>
                              n°{o.number} · {orderPlace(o)}
                            </strong>
                            <small>
                              {items} article{items > 1 ? 's' : ''} · {o.items.slice(0, 3).map((i) => i.name).join(', ')}
                              {o.items.length > 3 ? '…' : ''} · {sinceText(o.createdAt)}
                            </small>
                          </span>
                          <span className={STATUS_CLASS[o.status] ?? 'st'}>{ORDER_STATUS_LABELS[o.status]}</span>
                          <b className="num">{formatMoney(o.total, o.currency)}</b>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className="dash-col dash-col-side">
          {feed && (
            <section className="card">
              <h3>
                Service en cours
                <button type="button" className="btn btn-dashboard" onClick={() => onNavigate('orders')}>
                  Commandes
                </button>
              </h3>
              <div className="service">
                <ServiceTile n={count('PENDING')} label="À confirmer" alert onOpen={() => onNavigate('orders')} />
                <ServiceTile n={inKitchen} label="En cuisine" onOpen={() => onNavigate(can('kitchen.use') || can('bar.use') ? 'kitchen' : 'orders')} />
                <ServiceTile n={count('READY')} label="Prêtes à servir" ok onOpen={() => onNavigate('orders')} />
                <ServiceTile n={feed.requests.length} label="Demandes des tables" alert onOpen={() => onNavigate('orders')} />
                {lowStock !== null && <ServiceTile n={lowStock.length} label="Stock faible" alert detail={lowStock.slice(0, 2).join(', ')} onOpen={() => onNavigate('stock')} />}
              </div>
            </section>
          )}

          <section className="card">
            <h3>
              Plats les plus vendus
              {can('reports.read') && (
                <button type="button" className="btn btn-dashboard" onClick={() => onNavigate('reports')}>
                  Tout voir
                </button>
              )}
            </h3>
            {today && today.topProducts.length > 0 ? (
              <ol className="pop-list">
                {today.topProducts.slice(0, 5).map((p, i) => {
                  const src = photo(null, p.name);
                  return (
                    <li key={p.name} className="pop">
                      {src ? (
                        <img src={src} alt="" />
                      ) : (
                        <span className="pop-blank" aria-hidden="true">
                          <Icon name="kitchen" />
                        </span>
                      )}
                      <span className="pop-text">
                        <strong>{p.name}</strong>
                        <small>
                          {p.quantity} vendu{p.quantity > 1 ? 's' : ''} · {money(p.revenue)}
                        </small>
                      </span>
                      <b>#{i + 1}</b>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="card-empty">Aucune vente aujourd'hui</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

/** Compteur du service : l'ambre signale ce qui attend une action, le vert ce qui est prêt. */
function ServiceTile({ n, label, detail, alert, ok, onOpen }: { n: number; label: string; detail?: string; alert?: boolean; ok?: boolean; onOpen: () => void }) {
  const tone = n > 0 && alert ? ' serv-alert' : n > 0 && ok ? ' serv-ok' : '';
  return (
    <button type="button" className={`serv${tone}`} onClick={onOpen}>
      <b>{n}</b>
      <span>{label}</span>
      {detail && n > 0 && <small>{detail}</small>}
    </button>
  );
}

/** Graduation lisible : 1, 2 ou 5 × 10ⁿ au-dessus du maximum. */
function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Chiffre d'affaires heure par heure ; hier en retrait pour situer le service du jour ; la meilleure heure en or. */
function HourChart({ today, yesterday, cutoffHour = 0 }: { today: SalesReport; yesterday: SalesReport | null; cutoffHour?: number }) {
  const prev = yesterday?.byHour ?? [];
  // Heures dans l'ordre de la journée d'exploitation : le service d'après minuit se place en fin d'axe.
  const rank = (hour: number) => (hour - cutoffHour + 24) % 24;
  const known = [...today.byHour, ...prev].map((h) => rank(h.hour));
  const first = Math.min(rank(8), ...known);
  const last = Math.max(rank(22), ...known);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => (first + i + cutoffHour) % 24);
  const at = (list: SalesReport['byHour'], hour: number) => list.find((h) => h.hour === hour)?.revenue ?? 0;
  // Échelle d'au moins 10 000 (unités mineures) : sans vente, l'axe reste lisible (« 10 k / 5 k / 0 »).
  const scale = niceMax(Math.max(10_000, ...hours.map((h) => Math.max(at(today.byHour, h), at(prev, h)))));
  const best = Math.max(0, ...hours.map((h) => at(today.byHour, h)));
  const short = (v: number) => {
    const n = Number(moneyToInput(v, today.currency).replace(/\s/g, '').replace(',', '.'));
    if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
    return n >= 1000 ? `${Math.round(n / 1000)} k` : String(Math.round(n));
  };
  return (
    <div className="hchart">
      <div className="hchart-axis" aria-hidden="true">
        <span>{short(scale)}</span>
        <span>{short(scale / 2)}</span>
        <span>0</span>
      </div>
      <div className="hchart-main">
        <div className="hchart-plot">
          {hours.map((h) => {
            const now = at(today.byHour, h);
            const before = at(prev, h);
            return (
              <div className="hchart-col" key={h} title={`${h} h : ${formatMoney(now, today.currency)}${yesterday ? ` · hier ${formatMoney(before, today.currency)}` : ''}`}>
                {yesterday && <i className="hbar hbar-prev" style={{ height: `${(before * 100) / scale}%` }} />}
                <i className={now > 0 && now === best ? 'hbar hbar-now hbar-top' : 'hbar hbar-now'} style={{ height: `${(now * 100) / scale}%` }} />
              </div>
            );
          })}
          {today.byHour.length === 0 && <p className="hchart-empty">Aucune vente pour l'instant</p>}
        </div>
        <div className="hchart-x" aria-hidden="true">
          {hours.map((h) => (
            <span key={h}>{h % 2 === 0 ? `${h}h` : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
