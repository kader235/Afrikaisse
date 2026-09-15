import { useCallback, useEffect, useState } from 'react';
import { ORDER_STATUS_LABELS, businessDate, formatDuration, formatMoney, moneyToInput, shiftDate, type KitchenReport, type LocationDetails, type Me, type Order, type SalesReport } from '@afrikaisse/core';
import type { ActivityFeed } from '../activity.ts';
import { api } from '../api.ts';
import { ErrorMessage, Icon } from '../ui.tsx';
import '../styles/reports.css';

/**
 * Tableau de bord : ce qui se passe aujourd'hui dans l'établissement.
 * 1. l'essentiel (chiffre d'affaires, commandes, panier moyen, tables occupées), comparé à hier ;
 * 2. l'activité heure par heure ; 3. l'état du service, chaque ligne ouvrant l'écran concerné ;
 * puis les commandes en cours et les meilleures ventes. L'analyse d'une période est dans Rapports.
 */

export type DashboardTarget = 'orders' | 'kitchen' | 'floor' | 'stock' | 'pos' | 'reports';

const STATUS_CLASS: Partial<Record<Order['status'], string>> = {
  PENDING: 'st st-pending',
  CONFIRMED: 'st st-progress',
  PREPARING: 'st st-progress',
  READY: 'st st-ready',
  SERVED: 'st st-served',
};

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const where = (o: Order) => (o.tableLabel ? `Table ${o.tableLabel}` : o.serviceType === 'TAKEAWAY' ? 'À emporter' : 'Comptoir');

/** Écart avec hier, en pourcentage ; rien quand hier est vide (un « +∞ % » n'apprend rien). */
function change(now: number, before: number): string | null {
  if (before === 0) return null;
  const pct = Math.round(((now - before) * 1000) / before) / 10;
  if (pct === 0) return '= hier';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toLocaleString('fr-FR')} %`;
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
  const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section className="dash">
      <header className="page-head">
        <div className="page-title">
          <h1>Tableau de bord</h1>
          <p className="page-meta">{dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}</p>
        </div>
        <div className="page-actions">
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
          {can('pos.use') && (
            <button className="btn btn-primary" onClick={() => onNavigate('pos')}>
              <Icon name="add" />
              Nouvelle commande
            </button>
          )}
        </div>
      </header>

      <ErrorMessage error={error} />

      <section className="kpi-strip" aria-label="Aujourd'hui">
        <Kpi label="Chiffre d'affaires" value={t ? money(t.revenue) : '—'} change={t && y ? change(t.revenue, y.revenue) : null} before={y ? `hier à ${hourNow} h : ${money(y.revenue)}` : null} />
        <Kpi label="Commandes" value={t ? String(t.orders) : '—'} change={t && y ? change(t.orders, y.orders) : null} before={y ? `hier à ${hourNow} h : ${y.orders}` : null} />
        <Kpi label="Panier moyen" value={t ? money(t.averageTicket) : '—'} change={t && y ? change(t.averageTicket, y.averageTicket) : null} before={y ? `hier à ${hourNow} h : ${money(y.averageTicket)}` : null} />
        <Kpi
          label="Temps moyen"
          value={kitchen && kitchen.totals.measured > 0 ? formatDuration(kitchen.totals.averageMs) : '—'}
          before={kitchen ? (kitchen.totals.measured > 0 ? `${kitchen.totals.lateCount} en retard sur ${kitchen.totals.measured}` : 'Aucune commande prête') : null}
        />
        {tablesTotal !== null && (
          <Kpi label="Tables occupées" value={`${occupied} / ${tablesTotal}`} before={tablesTotal > 0 ? `${Math.round((occupied * 100) / tablesTotal)} % de la salle` : null} />
        )}
      </section>

      <div className="dash-grid">
        <section className="panel dash-activity">
          <header className="panel-header">
            <h2 className="panel-title">Activité du jour</h2>
            {yesterday && (
              <span className="chart-legend">
                <i className="lg-now" />
                Aujourd'hui
                <i className="lg-prev" />
                Hier
              </span>
            )}
          </header>
          <div className="panel-body">{today ? <HourChart today={today} yesterday={yesterday} cutoffHour={cutoffHour} /> : <p className="muted">Chargement…</p>}</div>
        </section>

        <section className="panel dash-now">
          <header className="panel-header">
            <h2 className="panel-title">État du service</h2>
            {feed && !feed.online && <span className="panel-note">Hors ligne</span>}
          </header>
          <ul className="now-list">
            {feed && <NowRow n={count('PENDING')} tone="alert" label="Commandes à confirmer" onOpen={() => onNavigate('orders')} />}
            {feed && <NowRow n={feed.requests.length} tone="alert" label="Demandes des tables" onOpen={() => onNavigate('orders')} />}
            {feed && <NowRow n={count('READY')} tone="ready" label="Prêtes à servir" onOpen={() => onNavigate('orders')} />}
            {feed && <NowRow n={count('CONFIRMED', 'PREPARING')} label="En préparation" onOpen={() => onNavigate(can('kitchen.use') || can('bar.use') ? 'kitchen' : 'orders')} />}
            {lowStock !== null && <NowRow n={lowStock.length} tone="alert" label="Stock faible" detail={lowStock.slice(0, 3).join(', ')} onOpen={() => onNavigate('stock')} />}
          </ul>
        </section>

        {feed && (
          <section className="panel dash-orders">
            <header className="panel-header">
              <h2 className="panel-title">
                Commandes en cours
                <span className="panel-count">{orders.length}</span>
              </h2>
              <button className="row-link" onClick={() => onNavigate('orders')}>
                Toutes
                <Icon name="chevronRight" />
              </button>
            </header>
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Où</th>
                    <th className="end">Articles</th>
                    <th>Heure</th>
                    <th className="end">Montant</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.length === 0 && (
                    <tr>
                      <td className="empty" colSpan={6}>
                        Aucune commande en cours
                      </td>
                    </tr>
                  )}
                  {latest.map((o) => (
                    <tr key={o.id} className="selectable" onClick={() => onNavigate('orders')}>
                      <td className="num">
                        <strong>{o.number}</strong>
                      </td>
                      <td>{where(o)}</td>
                      <td className="num end">{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
                      <td className="num">{hhmm(o.createdAt)}</td>
                      <td className="num end">{formatMoney(o.total, o.currency)}</td>
                      <td>
                        <span className={STATUS_CLASS[o.status] ?? 'st'}>{ORDER_STATUS_LABELS[o.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="panel dash-best">
          <header className="panel-header">
            <h2 className="panel-title">Meilleures ventes</h2>
          </header>
          {today && today.topProducts.length > 0 ? (
            <ol className="best-list">
              {today.topProducts.slice(0, 5).map((p, i) => (
                <li key={p.name}>
                  <span className="best-rank">{i + 1}</span>
                  <span className="best-name">{p.name}</span>
                  <span className="best-qty num">× {p.quantity}</span>
                  <span className="best-amount num">{money(p.revenue)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="panel-empty">Aucune vente aujourd'hui</p>
          )}
        </section>
      </div>
    </section>
  );
}

function Kpi({ label, value, change, before }: { label: string; value: string; change?: string | null; before?: string | null }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-context">
        {change && <b>{change}</b>}
        {before}
      </span>
    </div>
  );
}

function NowRow({ n, label, detail, tone, onOpen }: { n: number; label: string; detail?: string; tone?: 'alert' | 'ready'; onOpen: () => void }) {
  return (
    <li>
      <button className="now-row" onClick={onOpen}>
        <span className={n > 0 && tone ? `now-count ${tone}` : 'now-count'}>{n}</span>
        <span className="now-label">
          {label}
          {detail && <small>{detail}</small>}
        </span>
        <Icon name="chevronRight" />
      </button>
    </li>
  );
}

/** Graduation lisible : 1, 2 ou 5 × 10ⁿ au-dessus du maximum. */
function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Chiffre d'affaires heure par heure ; hier en retrait pour situer le service du jour. */
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
                <i className="hbar hbar-now" style={{ height: `${(now * 100) / scale}%` }} />
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
