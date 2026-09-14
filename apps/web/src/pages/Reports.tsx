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
 * Rapports : les ventes d'une période choisie, comparées à la période précédente de même durée.
 * Ce qui se passe aujourd'hui est sur le tableau de bord.
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
const spanDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

export function ReportsPage() {
  const [locations, setLocations] = useState<LocationDetails[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('week');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [previous, setPrevious] = useState<SalesReport | null>(null);
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
    // Période précédente de même durée, pour situer les chiffres (« +12 % »).
    const days = spanDays(range.from, range.to);
    const before = { from: shiftDate(range.from, -days), to: shiftDate(range.from, -1) };
    const url = (r: { from: string; to: string }) => `/locations/${locationId}/reports/sales?from=${r.from}&to=${r.to}`;
    try {
      const [current, earlier] = await Promise.all([api<SalesReport>('GET', url(range)), api<SalesReport>('GET', url(before)).catch(() => null)]);
      setReport(current);
      setPrevious(earlier);
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
  const period = report ? (report.from === report.to ? `Journée du ${shortDate(report.from)}` : `Du ${shortDate(report.from)} au ${shortDate(report.to)}`) : null;

  return (
    <Window
      title="Rapports"
      count={[location?.name, period].filter(Boolean).join(' · ') || undefined}
      plain
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
              Exporter
            </button>
          )}
        </>
      }
    >
      <div className="report-page">
        <ErrorMessage error={error} />
        {!report && !error && <p className="muted">Chargement…</p>}
        {report && (
          <>
            <section className="summary" aria-label="Ventes de la période">
              <dl className="summary-figures">
                <Figure label="Chiffre d'affaires" value={money(report.totals.revenue)} now={report.totals.revenue} before={previous?.totals.revenue} />
                <Figure label="Encaissé" value={money(report.totals.collected)} now={report.totals.collected} before={previous?.totals.collected} />
                <Figure label="Commandes" value={String(report.totals.orders)} now={report.totals.orders} before={previous?.totals.orders} />
                <Figure label="Panier moyen" value={money(report.totals.averageTicket)} now={report.totals.averageTicket} before={previous?.totals.averageTicket} />
              </dl>
              <div className="summary-foot">
                <span>
                  Articles vendus <strong className="num">{report.totals.itemsSold}</strong>
                </span>
                <span>
                  Remises <strong className="num">{money(report.totals.discounts)}</strong>
                </span>
                <span>
                  Annulées <strong className="num">{report.totals.cancelledCount}</strong>
                  {report.totals.cancelledCount > 0 && ` (${money(report.totals.cancelledAmount)})`}
                </span>
              </div>
            </section>

            <fieldset className="group">
              <legend>{report.from === report.to ? 'Ventes du jour' : 'Ventes par jour'}</legend>
              <DayBars report={report} money={money} />
            </fieldset>

            <div className="report-grid">
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
                          <td className="num end">{m.count}</td>
                          <td className="num end">{money(m.amount)}</td>
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
                        <th className="end">Qté</th>
                        <th className="end">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.topProducts.map((p, i) => (
                        <tr key={p.name}>
                          <td className="num">{i + 1}</td>
                          <td>{p.name}</td>
                          <td className="num end">{p.quantity}</td>
                          <td className="num end">{money(p.revenue)}</td>
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

function Figure({ label, value, now, before }: { label: string; value: string; now: number; before: number | undefined }) {
  return (
    <div className="summary-figure">
      <dt>{label}</dt>
      <dd>
        <strong className="fig-value">{value}</strong>
        <Delta now={now} before={before} />
      </dd>
    </div>
  );
}

function Delta({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return null;
  if (before === 0) return <span className="fig-delta">{now === 0 ? 'Stable' : 'Aucune vente avant'}</span>;
  const change = Math.round(((now - before) * 1000) / before) / 10;
  if (change === 0) return <span className="fig-delta">Stable</span>;
  return <span className="fig-delta">{`${change > 0 ? '▲' : '▼'} ${Math.abs(change).toLocaleString('fr-FR')} %`}</span>;
}

function MiniTable({ title, rows }: { title: string; rows: [string, number, string][] }) {
  if (rows.length === 0) return null;
  return (
    <table className="grid compact">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="end">Cmd</th>
          <th className="end">Montant</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, count, amount]) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="num end">{count}</td>
            <td className="num end">{amount}</td>
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
    ['Panier moyen', m(report.totals.averageTicket)],
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
