import { useCallback, useEffect, useState } from 'react';
import {
  PAYMENT_METHOD_LABELS,
  SERVICE_TYPE_LABELS,
  businessDate,
  formatMoney,
  moneyToInput,
  shiftDate,
  type LocationDetails,
  type SalesReport,
} from '@afrikaisse/core';
import { api } from '../api.ts';
import { ORDER_SOURCE_LABELS } from '../labels.ts';
import { isNativeApp } from '../platform.ts';
import { ErrorMessage, Icon, Window } from '../ui.tsx';

/**
 * Tableau de bord du gérant : ventes d'une période de journées d'exploitation.
 * Graphiques en simples barres CSS : lisibles sur la vieille WebView d'une tablette, sans bibliothèque.
 */

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'thisMonth' | 'custom';

const PRESETS: [Preset, string][] = [
  ['today', "Aujourd'hui"],
  ['yesterday', 'Hier'],
  ['week', '7 jours'],
  ['month', '30 jours'],
  ['thisMonth', 'Ce mois'],
];

function presetRange(preset: Preset, day: string): { from: string; to: string } | null {
  switch (preset) {
    case 'today':
      return { from: day, to: day };
    case 'yesterday':
      return { from: shiftDate(day, -1), to: shiftDate(day, -1) };
    case 'week':
      return { from: shiftDate(day, -6), to: day };
    case 'month':
      return { from: shiftDate(day, -29), to: day };
    case 'thisMonth':
      return { from: `${day.slice(0, 8)}01`, to: day };
    default:
      return null;
  }
}

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const pct = (part: number, total: number) => (total > 0 ? Math.round((part * 100) / total) : 0);

export function ReportsPage() {
  const [locations, setLocations] = useState<LocationDetails[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const location = locations?.find((l) => l.id === locationId) ?? null;
  const today = location ? businessDate(Date.now(), location.timezone, location.businessDayCutoffMin) : null;

  useEffect(() => {
    api<LocationDetails[]>('GET', '/locations').then((list) => {
      setLocations(list);
      setLocationId((current) => current ?? list[0]?.id ?? null);
    }, setError);
  }, []);

  useEffect(() => {
    if (today && preset !== 'custom') setRange(presetRange(preset, today));
  }, [preset, today]);

  const load = useCallback(async () => {
    if (!locationId || !range) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await api<SalesReport>('GET', `/locations/${locationId}/reports/sales?from=${range.from}&to=${range.to}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [locationId, range]);
  useEffect(() => {
    void load();
  }, [load]);

  const money = (v: number) => (report ? formatMoney(v, report.currency) : '');

  return (
    <Window
      title={location ? `Tableau de bord — ${location.name}` : 'Tableau de bord'}
      count={report ? (report.from === report.to ? `Journée du ${shortDate(report.from)}` : `Du ${shortDate(report.from)} au ${shortDate(report.to)}`) : undefined}
      bodyless
      toolbar={
        <>
          {locations && locations.length > 1 && (
            <select aria-label="Établissement" value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <span className="segmented">
            {PRESETS.map(([id, label]) => (
              <button key={id} className="btn" aria-pressed={preset === id} onClick={() => setPreset(id)}>
                {label}
              </button>
            ))}
          </span>
          <span className="sep" />
          <label className="report-date">
            Du
            <input
              type="date"
              value={range?.from ?? ''}
              max={range?.to}
              onChange={(e) => {
                if (!e.target.value || !range) return;
                setPreset('custom');
                setRange({ ...range, from: e.target.value });
              }}
            />
          </label>
          <label className="report-date">
            au
            <input
              type="date"
              value={range?.to ?? ''}
              min={range?.from}
              onChange={(e) => {
                if (!e.target.value || !range) return;
                setPreset('custom');
                setRange({ ...range, to: e.target.value });
              }}
            />
          </label>
          <span className="sep" />
          <button className="btn" disabled={loading} onClick={() => void load()}>
            <Icon name="refresh" />
            Actualiser
          </button>
          {!isNativeApp() && (
            <button className="btn" disabled={!report} onClick={() => report && exportCsv(report, location?.name ?? 'afrikaisse')}>
              <Icon name="save" />
              Exporter (CSV)
            </button>
          )}
        </>
      }
    >
      <div className="window-body">
        <ErrorMessage error={error} />
        {!report && !error && <p className="muted">Chargement…</p>}
        {report && (
          <>
            <div className="kpis">
              <Kpi label="Chiffre d'affaires" value={money(report.totals.revenue)} strong />
              <Kpi label="Encaissé" value={money(report.totals.collected)} />
              <Kpi label="Commandes" value={String(report.totals.orders)} />
              <Kpi label="Ticket moyen" value={money(report.totals.averageTicket)} />
              <Kpi label="Articles vendus" value={String(report.totals.itemsSold)} />
              <Kpi label="Remises" value={money(report.totals.discounts)} />
              <Kpi label="Annulées" value={`${report.totals.cancelledCount} · ${money(report.totals.cancelledAmount)}`} />
            </div>

            <div className="report-grid">
              <fieldset className="group">
                <legend>Ventes par jour</legend>
                <DayBars report={report} money={money} />
              </fieldset>

              <fieldset className="group">
                <legend>Modes de paiement</legend>
                {report.byMethod.length === 0 ? (
                  <p className="muted">Aucun encaissement sur la période.</p>
                ) : (
                  <table className="grid compact">
                    <tbody>
                      {report.byMethod.map((m) => (
                        <tr key={m.method}>
                          <td>{PAYMENT_METHOD_LABELS[m.method]}</td>
                          <td className="num">{m.count}</td>
                          <td className="num">{money(m.amount)}</td>
                          <td className="share-cell">
                            <span className="share">
                              <i style={{ width: `${pct(m.amount, report.totals.collected)}%` }} />
                            </span>
                            {pct(m.amount, report.totals.collected)} %
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="report-split">
                  <MiniTable title="Origine" rows={report.bySource.map((s) => [ORDER_SOURCE_LABELS[s.source], s.orders, money(s.revenue)])} />
                  <MiniTable title="Service" rows={report.byServiceType.map((s) => [SERVICE_TYPE_LABELS[s.serviceType], s.orders, money(s.revenue)])} />
                </div>
              </fieldset>

              <fieldset className="group">
                <legend>Heures de service</legend>
                <HourBars report={report} money={money} />
              </fieldset>

              <fieldset className="group">
                <legend>Produits les plus vendus</legend>
                {report.topProducts.length === 0 ? (
                  <p className="muted">Aucune vente sur la période.</p>
                ) : (
                  <table className="grid compact">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Produit</th>
                        <th>Qté</th>
                        <th>Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.topProducts.map((p, i) => (
                        <tr key={p.name}>
                          <td className="num">{i + 1}</td>
                          <td>{p.name}</td>
                          <td className="num">{p.quantity}</td>
                          <td className="num">{money(p.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </fieldset>
            </div>
          </>
        )}
      </div>
    </Window>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'kpi kpi-main' : 'kpi'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniTable({ title, rows }: { title: string; rows: [string, number, string][] }) {
  if (rows.length === 0) return null;
  return (
    <table className="grid compact">
      <thead>
        <tr>
          <th>{title}</th>
          <th>Cmd</th>
          <th>Montant</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, count, amount]) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="num">{count}</td>
            <td className="num">{amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DayBars({ report, money }: { report: SalesReport; money: (v: number) => string }) {
  const max = Math.max(1, ...report.byDay.map((d) => d.revenue));
  const every = Math.ceil(report.byDay.length / 15);
  if (report.byDay.length === 1) {
    const d = report.byDay[0]!;
    return (
      <p className="report-single">
        <strong>{money(d.revenue)}</strong> · {d.orders} commande(s) · encaissé {money(d.collected)}
      </p>
    );
  }
  return (
    <div className="bars">
      {report.byDay.map((d, i) => (
        <div className="bar-col" key={d.date} title={`${shortDate(d.date)} : ${money(d.revenue)} · ${d.orders} commande(s)`}>
          <div className="bar" style={{ height: `${Math.round((d.revenue * 100) / max)}%` }} />
          <span>{i % every === 0 ? shortDate(d.date) : ''}</span>
        </div>
      ))}
    </div>
  );
}

function HourBars({ report, money }: { report: SalesReport; money: (v: number) => string }) {
  if (report.byHour.length === 0) return <p className="muted">Aucune vente sur la période.</p>;
  const first = report.byHour[0]!.hour;
  const last = report.byHour.at(-1)!.hour;
  const max = Math.max(1, ...report.byHour.map((h) => h.orders));
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return (
    <div className="bars">
      {hours.map((hour) => {
        const slot = report.byHour.find((h) => h.hour === hour);
        return (
          <div className="bar-col" key={hour} title={`${hour} h : ${slot?.orders ?? 0} commande(s) · ${money(slot?.revenue ?? 0)}`}>
            <div className="bar bar-alt" style={{ height: `${Math.round(((slot?.orders ?? 0) * 100) / max)}%` }} />
            <span>{hour}h</span>
          </div>
        );
      })}
    </div>
  );
}

/** CSV pour Excel en français : point-virgule, BOM UTF-8, montants en unités courantes. */
function exportCsv(report: SalesReport, locationName: string) {
  const m = (v: number) => moneyToInput(v, report.currency);
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines: (string | number)[][] = [
    [`Ventes ${locationName}`, `du ${report.from} au ${report.to}`, report.currency],
    [],
    ['Indicateur', 'Valeur'],
    ["Chiffre d'affaires", m(report.totals.revenue)],
    ['Encaissé', m(report.totals.collected)],
    ['Commandes', report.totals.orders],
    ['Ticket moyen', m(report.totals.averageTicket)],
    ['Articles vendus', report.totals.itemsSold],
    ['Remises', m(report.totals.discounts)],
    ['Commandes annulées', report.totals.cancelledCount],
    ['Montant annulé', m(report.totals.cancelledAmount)],
    [],
    ['Journée', "Chiffre d'affaires", 'Commandes', 'Encaissé'],
    ...report.byDay.map((d) => [d.date, m(d.revenue), d.orders, m(d.collected)]),
    [],
    ['Mode de paiement', 'Nombre', 'Montant'],
    ...report.byMethod.map((p) => [PAYMENT_METHOD_LABELS[p.method], p.count, m(p.amount)]),
    [],
    ['Produit', 'Quantité', 'Montant'],
    ...report.topProducts.map((p) => [p.name, p.quantity, m(p.revenue)]),
  ];
  const csv = lines.map((row) => row.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `ventes-${report.from}-${report.to}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
