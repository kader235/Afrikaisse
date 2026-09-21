import { useCallback, useEffect, useState } from 'react';
import { ORDER_STATUS_LABELS, businessDate, formatMoney, moneyToInput, shiftDate, type LocationDetails, type Me, type Order, type SalesReport } from '@afrikaisse/core';
import type { ActivityFeed } from '../activity.ts';
import { api } from '../api.ts';
import { orderPlace, sinceText } from '../labels.ts';
import { mediaSrc } from '../platform.ts';
import { useProductPhotos } from '../productPhotos.ts';
import { ServiceHeader } from '../serviceHeader.tsx';
import { ErrorMessage, Icon } from '../ui.tsx';
import { DailyMenuWidget } from './DailyMenuWidget.tsx';
import '../styles/reports.css';

/**
 * Tableau de bord (design v3) : ce qui se passe aujourd'hui dans l'établissement.
 * Colonne gauche : les deux chiffres clés (chiffre d'affaires, commandes du jour), puis les ventes
 * heure par heure et les commandes en direct. Colonne droite : le menu du jour, déroulé sur toute la
 * hauteur (menu du client QR, plats à marquer épuisés). L'analyse d'une période est dans Rapports.
 * Même écran à la tablette et au PC ; il défile s'il le faut.
 */

export type DashboardTarget = 'orders' | 'kitchen' | 'floor' | 'stock' | 'pos' | 'reports' | 'take' | 'menu' | 'account';

const STATUS_CLASS: Partial<Record<Order['status'], string>> = {
  PENDING: 'st st-pending',
  CONFIRMED: 'st st-progress',
  PREPARING: 'st st-progress',
  READY: 'st st-ready',
  SERVED: 'st st-served',
};

export function DashboardPage({ me, feed, onNavigate }: { me: Me; feed?: ActivityFeed; onNavigate: (target: DashboardTarget) => void }) {
  const can = (p: Me['permissions'][number]) => me.permissions.includes(p);
  const canStock = can('inventory.read');
  const [locations, setLocations] = useState<LocationDetails[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [today, setToday] = useState<SalesReport | null>(null);
  const [yesterday, setYesterday] = useState<SalesReport | null>(null);
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
      const [current, before] = await Promise.all([
        api<SalesReport>('GET', url(day)),
        api<SalesReport>('GET', url(shiftDate(day, -1))).catch(() => null),
      ]);
      setToday(current);
      setYesterday(before);
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
    if (canStock) api<{ name: string; state: string }[]>('GET', `/locations/${locationId}/inventory`).then((list) => setLowStock(list.filter((i) => i.state !== 'OK').map((i) => i.name)), () => setLowStock(null));
  }, [locationId, canStock]);

  const orders = feed?.orders ?? [];
  const count = (...statuses: Order['status'][]) => orders.filter((o) => statuses.includes(o.status)).length;
  const money = (v: number) => (today ? formatMoney(v, today.currency) : '—');
  const t = today?.totals;
  const cutoffHour = location ? Math.floor(location.businessDayCutoffMin / 60) : 0;
  const latest = [...orders].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const heroPhoto = today?.topProducts.map((p) => photo(null, p.name)).find((x) => x) ?? null;
  const logo = location?.logoUrl ? mediaSrc(location.logoUrl) : heroPhoto;
  const inKitchen = count('CONFIRMED', 'PREPARING');
  const pending = count('PENDING');
  // Menu du jour : panneau pleine hauteur à droite (menu du client QR, plats épuisés).
  const showMenu = !!locationId && can('menu.read');
  // Teinte du nuage de chaque widget : bleu = information, jaune = à traiter, rouge = urgent.
  const liveTone = feed && feed.requests.length > 0 ? 'rouge' : pending > 0 ? 'jaune' : 'bleu';
  return (
    <section className="dash dash-fit">
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
      </ServiceHeader>

      <ErrorMessage error={error} />

      <div className={`dash-cols${showMenu ? '' : ' dash-cols-solo'}`}>
        <div className="dash-primary">
          <div className="kpis" aria-label="Aujourd'hui">
            <div className="kpi kpi-hero nuage">
              <small>
                <Icon name="cash" />
                Chiffre d'affaires du jour
              </small>
              <strong>{t ? money(t.revenue) : '—'}</strong>
            </div>
            <div className={`kpi nuage nuage-${pending > 0 ? 'jaune' : 'bleu'}`}>
              <small>
                <Icon name="ticket" />
                Commandes
              </small>
              <strong>{t ? String(t.orders) : '—'}</strong>
            </div>
          </div>

          <div className="dash-col">
          <section className="card dash-chart nuage nuage-bleu">
            <h3>
              Ventes par heure
              {can('reports.read') && (
                <button type="button" className="btn btn-dashboard" onClick={() => onNavigate('reports')}>
                  <Icon name="chart" />
                  Rapports
                </button>
              )}
            </h3>
            {today ? <HourChart today={today} yesterday={yesterday} cutoffHour={cutoffHour} /> : <p className="muted">Chargement…</p>}
          </section>

          {feed && (
            <section className={`card dash-live nuage nuage-${liveTone}`}>
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
                  <Icon name="chevronRight" />
                </button>
              </h3>
              {(pending > 0 || inKitchen > 0 || count('READY') > 0 || feed.requests.length > 0 || (lowStock?.length ?? 0) > 0) && (
                <div className="live-tags">
                  {pending > 0 && (
                    <button type="button" className="etq etq-warn" onClick={() => onNavigate('orders')}>
                      {pending} à confirmer
                    </button>
                  )}
                  {inKitchen > 0 && (
                    <button type="button" className="etq etq-info" onClick={() => onNavigate(can('kitchen.use') || can('bar.use') ? 'kitchen' : 'orders')}>
                      {inKitchen} en cuisine
                    </button>
                  )}
                  {count('READY') > 0 && (
                    <button type="button" className="etq etq-ok" onClick={() => onNavigate('orders')}>
                      {count('READY')} prête{count('READY') > 1 ? 's' : ''} à servir
                    </button>
                  )}
                  {feed.requests.length > 0 && (
                    <button type="button" className="etq etq-danger" onClick={() => onNavigate('orders')}>
                      {feed.requests.length} demande{feed.requests.length > 1 ? 's' : ''} de table
                    </button>
                  )}
                  {lowStock !== null && lowStock.length > 0 && (
                    <button type="button" className="etq etq-warn" onClick={() => onNavigate('stock')}>
                      Stock faible : {lowStock.length}
                    </button>
                  )}
                </div>
              )}
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
        </div>

        {showMenu && locationId && (
          <div className="dash-col dash-col-side">
            <DailyMenuWidget locationId={locationId} canManage={can('menu.manage')} canAvailability={can('menu.availability')} photo={photo} />
          </div>
        )}
      </div>
    </section>
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
