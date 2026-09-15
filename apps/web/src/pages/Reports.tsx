import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  INVENTORY_UNIT_LABELS,
  MOVEMENT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  SERVICE_TYPE_LABELS,
  businessDate,
  csvDocument,
  formatDuration,
  formatMoney,
  groupDays,
  moneyToInput,
  shiftDate,
  type BreakdownReport,
  type CsvValue,
  type CurrencyCode,
  type KitchenReport,
  type LocationDetails,
  type Me,
  type PeriodGrain,
  type SalesReport,
  type StockReport,
} from '@afrikaisse/core';
import { api } from '../api.ts';
import { ORDER_SOURCE_LABELS } from '../labels.ts';
import { isNativeApp } from '../platform.ts';
import { ErrorMessage, Icon, Window } from '../ui.tsx';
import '../styles/reports.css';

/**
 * Rapports d'une période : ventes (comparées à la période précédente de même durée), périodes
 * (jour, semaine, mois), produits, catégories, personnel, paiements, cuisine, stock.
 * Chaque onglet produit un document (sections de tableaux) qui sert à l'écran, à l'export CSV et à
 * l'impression A4. Graphiques en simples barres CSS : lisibles sur la vieille WebView d'une tablette.
 */

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'thisMonth' | 'year' | 'custom';
type Range = { from: string; to: string };

const PRESETS: [Preset, string][] = [
  ['today', "Aujourd'hui"],
  ['yesterday', 'Hier'],
  ['week', '7 jours'],
  ['month', '30 jours'],
  ['thisMonth', 'Ce mois'],
  ['year', 'Cette année'],
];

type Tab = 'sales' | 'periods' | 'products' | 'categories' | 'staff' | 'payments' | 'kitchen' | 'stock';
const TABS: [Tab, string][] = [
  ['sales', 'Ventes'],
  ['periods', 'Périodes'],
  ['products', 'Produits'],
  ['categories', 'Catégories'],
  ['staff', 'Personnel'],
  ['payments', 'Paiements'],
  ['kitchen', 'Cuisine'],
  ['stock', 'Stock'],
];

type Dataset = 'sales' | 'breakdown' | 'kitchen' | 'stock';
const DATASET: Record<Tab, Dataset> = {
  sales: 'sales',
  periods: 'sales',
  products: 'breakdown',
  categories: 'breakdown',
  staff: 'breakdown',
  payments: 'breakdown',
  kitchen: 'kitchen',
  stock: 'stock',
};

const GRAINS: [PeriodGrain, string][] = [
  ['day', 'Jour'],
  ['week', 'Semaine'],
  ['month', 'Mois'],
];

const FILE_NAMES: Record<Tab, string> = {
  sales: 'ventes',
  periods: 'ventes-periodes',
  products: 'produits',
  categories: 'categories',
  staff: 'personnel',
  payments: 'paiements',
  kitchen: 'cuisine',
  stock: 'stock',
};

interface Loaded {
  sales?: { report: SalesReport; previous: SalesReport | null };
  breakdown?: BreakdownReport;
  kitchen?: KitchenReport;
  stock?: StockReport;
}

function presetRange(preset: Preset, day: string): Range | null {
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
    case 'year':
      return { from: `${day.slice(0, 4)}-01-01`, to: day };
    default:
      return null;
  }
}

const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const frDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const pct = (part: number, total: number) => (total > 0 ? Math.round((part * 100) / total) : 0);
const spanDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const periodLabel = (r: Range) => (r.from === r.to ? `Journée du ${frDate(r.from)}` : `Du ${frDate(r.from)} au ${frDate(r.to)}`);

async function fetchDataset(dataset: Dataset, locationId: string, range: Range): Promise<Loaded[Dataset]> {
  const url = (kind: string, r: Range) => `/locations/${locationId}/reports/${kind}?from=${r.from}&to=${r.to}`;
  if (dataset === 'sales') {
    // Période précédente de même durée, pour situer les chiffres (« +12 % »).
    const days = spanDays(range.from, range.to);
    const before = { from: shiftDate(range.from, -days), to: shiftDate(range.from, -1) };
    const [report, previous] = await Promise.all([api<SalesReport>('GET', url('sales', range)), api<SalesReport>('GET', url('sales', before)).catch(() => null)]);
    return { report, previous };
  }
  return api<Loaded[Dataset]>('GET', url(dataset, range));
}

export function ReportsPage({ me }: { me: Me }) {
  const tabs = TABS.filter(([id]) => id !== 'stock' || me.permissions.includes('inventory.read'));
  const [locations, setLocations] = useState<LocationDetails[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('week');
  const [range, setRange] = useState<Range | null>(null);
  const [tab, setTab] = useState<Tab>('sales');
  const [grain, setGrain] = useState<PeriodGrain>('day');
  const [cache, setCache] = useState<Record<string, Loaded[Dataset]>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState<ReportDoc | null>(null);

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

  const dataset = DATASET[tab];
  const key = locationId && range ? `${dataset}|${locationId}|${range.from}|${range.to}` : null;

  const load = useCallback(
    async (force = false) => {
      if (!key || !locationId || !range) return;
      if (!force && cacheRef.current[key]) return;
      setLoading(true);
      setError(null);
      try {
        const value = await fetchDataset(dataset, locationId, range);
        setCache((current) => ({ ...current, [key]: value }));
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [key, dataset, locationId, range],
  );
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 150);
    return () => clearTimeout(timer);
  }, [printing]);

  const value = key ? cache[key] : undefined;
  const loaded: Loaded = value === undefined ? {} : { [dataset]: value };
  const currency: CurrencyCode = location?.currency ?? 'XAF';
  const display = makeFmt(currency, false);
  const doc = value === undefined ? null : buildDoc(tab, grain, loaded, display);
  const money = (v: number) => formatMoney(v, currency);

  function exportCsv() {
    if (!range || !location) return;
    const csvDoc = buildDoc(tab, grain, loaded, makeFmt(currency, true));
    if (!csvDoc) return;
    const rows: CsvValue[][] = [[csvDoc.title, location.name, periodLabel(range)], []];
    for (const s of csvDoc.sections) rows.push([s.heading], s.columns, ...s.rows, []);
    const url = URL.createObjectURL(new Blob([csvDocument(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${FILE_NAMES[tab]}-${range.from}-${range.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <Window
      title="Rapports"
      count={[location?.name, range && periodLabel(range)].filter(Boolean).join(' · ') || undefined}
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
          <button className="btn" disabled={loading} onClick={() => void load(true)}>
            <Icon name="refresh" />
            Actualiser
          </button>
          {!isNativeApp() && (
            <>
              <button className="btn" disabled={!doc} onClick={exportCsv}>
                <Icon name="save" />
                Exporter
              </button>
              <button className="btn" disabled={!doc} onClick={() => setPrinting(doc)}>
                <Icon name="print" />
                Imprimer
              </button>
            </>
          )}
        </>
      }
    >
      <div className="report-page">
        <div className="subtabs report-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <ErrorMessage error={error} />
        {value === undefined && !error && <p className="muted">Chargement…</p>}

        {tab === 'sales' && loaded.sales && <SalesView report={loaded.sales.report} previous={loaded.sales.previous} money={money} />}

        {tab === 'periods' && doc && (
          <>
            <div className="report-grain">
              <span className="segmented" role="group" aria-label="Regroupement">
                {GRAINS.map(([id, label]) => (
                  <button key={id} className="btn" aria-pressed={grain === id} onClick={() => setGrain(id)}>
                    {label}
                  </button>
                ))}
              </span>
            </div>
            <DocView doc={doc} />
          </>
        )}

        {(tab === 'products' || tab === 'categories' || tab === 'staff' || tab === 'payments') && doc && <DocView doc={doc} />}

        {tab === 'kitchen' && loaded.kitchen && doc && (
          <>
            <section className="summary" aria-label="Temps de préparation">
              <dl className="summary-figures">
                <Figure label="Temps moyen" value={loaded.kitchen.totals.measured ? formatDuration(loaded.kitchen.totals.averageMs) : '—'} />
                <Figure label="Temps médian" value={loaded.kitchen.totals.measured ? formatDuration(loaded.kitchen.totals.medianMs) : '—'} />
                <Figure label="Plus long" value={loaded.kitchen.totals.measured ? formatDuration(loaded.kitchen.totals.maxMs) : '—'} />
                <Figure label="En retard" value={`${loaded.kitchen.totals.lateCount} / ${loaded.kitchen.totals.measured}`} />
              </dl>
            </section>
            <DocView doc={{ ...doc, sections: doc.sections.slice(1) }} />
          </>
        )}

        {tab === 'stock' && loaded.stock && doc && (
          <>
            <section className="summary" aria-label="Stock de la période">
              <dl className="summary-figures report-figures-3">
                <Figure label="Réceptions" value={money(loaded.stock.totals.receivedValue)} />
                <Figure label="Consommation" value={money(loaded.stock.totals.consumedValue)} />
                <Figure label="Pertes" value={money(loaded.stock.totals.lossValue)} />
              </dl>
            </section>
            <DocView doc={doc} />
          </>
        )}
      </div>
      {printing && location && range && createPortal(<PrintReport doc={printing} me={me} location={location} period={periodLabel(range)} />, document.body)}
    </Window>
  );
}

// --- Document : écran, CSV, impression ------------------------------------------

interface DocSection {
  heading: string;
  columns: string[];
  rows: CsvValue[][];
  /** Colonnes numériques, alignées à droite. */
  end: number[];
  /** Dernière ligne = total. */
  total?: boolean;
}

interface ReportDoc {
  title: string;
  sections: DocSection[];
}

interface Fmt {
  csv: boolean;
  money: (v: number) => CsvValue;
  qty: (v: number) => CsvValue;
  dur: (ms: number) => CsvValue;
  pct: (part: number, total: number) => CsvValue;
  date: (d: string) => string;
  month: (ym: string) => string;
  stamp: (ms: number) => string;
}

const share = (part: number, total: number) => (total > 0 ? Math.round((part * 1000) / total) / 10 : 0);

/** CSV : nombres bruts (virgule décimale posée à l'export), durées en minutes. Écran et impression : texte formaté. */
function makeFmt(currency: CurrencyCode, csv: boolean): Fmt {
  if (csv) {
    return {
      csv,
      money: (v) => moneyToInput(v, currency),
      qty: (v) => v,
      dur: (ms) => Math.round(ms / 6000) / 10,
      pct: share,
      date: (d) => d,
      month: (ym) => ym,
      stamp: (ms) => new Date(ms).toLocaleString('fr-FR'),
    };
  }
  return {
    csv,
    money: (v) => formatMoney(v, currency),
    qty: (v) => v.toLocaleString('fr-FR', { maximumFractionDigits: 3 }),
    dur: formatDuration,
    pct: (p, t) => `${share(p, t).toLocaleString('fr-FR')} %`,
    date: frDate,
    month: (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    stamp: (ms) => new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
  };
}

function buildDoc(tab: Tab, grain: PeriodGrain, data: Loaded, f: Fmt): ReportDoc | null {
  const d = (label: string) => (f.csv ? `${label} (min)` : label);
  const ca = "Chiffre d'affaires";
  switch (tab) {
    case 'sales': {
      const r = data.sales?.report;
      if (!r) return null;
      const t = r.totals;
      return {
        title: 'Ventes',
        sections: [
          {
            heading: 'Indicateurs',
            columns: ['Indicateur', 'Valeur'],
            end: [1],
            rows: [
              [ca, f.money(t.revenue)],
              ['Encaissé', f.money(t.collected)],
              ['Commandes', t.orders],
              ['Panier moyen', f.money(t.averageTicket)],
              ['Articles vendus', t.itemsSold],
              ['Remises', f.money(t.discounts)],
              ['Commandes annulées', t.cancelledCount],
              ['Montant annulé', f.money(t.cancelledAmount)],
            ],
          },
          { heading: 'Ventes par jour', columns: ['Journée', ca, 'Commandes', 'Encaissé'], end: [1, 2, 3], rows: r.byDay.map((x) => [f.date(x.date), f.money(x.revenue), x.orders, f.money(x.collected)]) },
          { heading: 'Modes de paiement', columns: ['Mode', 'Nombre', 'Montant'], end: [1, 2], rows: r.byMethod.map((m) => [PAYMENT_METHOD_LABELS[m.method], m.count, f.money(m.amount)]) },
          { heading: 'Heures de service', columns: ['Heure', 'Commandes', ca], end: [1, 2], rows: r.byHour.map((h) => [`${h.hour} h`, h.orders, f.money(h.revenue)]) },
          { heading: 'Origine', columns: ['Origine', 'Commandes', ca], end: [1, 2], rows: r.bySource.map((s) => [ORDER_SOURCE_LABELS[s.source], s.orders, f.money(s.revenue)]) },
          { heading: 'Type de service', columns: ['Service', 'Commandes', ca], end: [1, 2], rows: r.byServiceType.map((s) => [SERVICE_TYPE_LABELS[s.serviceType], s.orders, f.money(s.revenue)]) },
          { heading: 'Produits les plus vendus', columns: ['Produit', 'Quantité', 'Montant'], end: [1, 2], rows: r.topProducts.map((p) => [p.name, p.quantity, f.money(p.revenue)]) },
        ],
      };
    }
    case 'periods': {
      const r = data.sales?.report;
      if (!r) return null;
      const label = (date: string) => (grain === 'day' ? f.date(date) : grain === 'week' ? `Semaine du ${f.date(date)}` : f.month(date));
      return {
        title: grain === 'day' ? 'Ventes journalières' : grain === 'week' ? 'Ventes hebdomadaires' : 'Ventes mensuelles',
        sections: [
          {
            heading: grain === 'day' ? 'Par jour' : grain === 'week' ? 'Par semaine' : 'Par mois',
            columns: ['Période', 'Commandes', ca, 'Encaissé', 'Panier moyen'],
            end: [1, 2, 3, 4],
            total: true,
            rows: [
              ...groupDays(r.byDay, grain).map((p) => [label(p.date), p.orders, f.money(p.revenue), f.money(p.collected), f.money(p.orders ? Math.floor(p.revenue / p.orders) : 0)]),
              ['Total', r.totals.orders, f.money(r.totals.revenue), f.money(r.totals.collected), f.money(r.totals.averageTicket)],
            ],
          },
        ],
      };
    }
    case 'products':
    case 'categories':
    case 'staff':
    case 'payments': {
      const b = data.breakdown;
      if (!b) return null;
      if (tab === 'products') {
        const total = b.products.reduce((s, p) => s + p.revenue, 0);
        return {
          title: 'Ventes par produit',
          sections: [{ heading: 'Produits', columns: ['#', 'Produit', 'Catégorie', 'Quantité', 'Montant', 'Part'], end: [0, 3, 4, 5], rows: b.products.map((p, i) => [i + 1, p.name, p.categoryName, p.quantity, f.money(p.revenue), f.pct(p.revenue, total)]) }],
        };
      }
      if (tab === 'categories') {
        const total = b.categories.reduce((s, c) => s + c.revenue, 0);
        return {
          title: 'Ventes par catégorie',
          sections: [{ heading: 'Catégories', columns: ['Catégorie', 'Quantité', 'Montant', 'Part'], end: [1, 2, 3], rows: b.categories.map((c) => [c.name, c.quantity, f.money(c.revenue), f.pct(c.revenue, total)]) }],
        };
      }
      if (tab === 'staff') {
        return {
          title: 'Ventes par membre du personnel',
          sections: [
            {
              heading: 'Personnel',
              columns: ['Membre', 'Commandes', ca, 'Panier moyen', 'Encaissements', 'Encaissé'],
              end: [1, 2, 3, 4, 5],
              rows: b.staff.map((s) => [s.name, s.orders, f.money(s.revenue), f.money(s.averageTicket), s.payments, f.money(s.collected)]),
            },
          ],
        };
      }
      const collected = b.payments.byMethod.reduce((s, m) => s + m.amount, 0);
      return {
        title: 'Paiements',
        sections: [
          { heading: 'Modes de paiement', columns: ['Mode', 'Nombre', 'Montant', 'Part'], end: [1, 2, 3], rows: b.payments.byMethod.map((m) => [PAYMENT_METHOD_LABELS[m.method], m.count, f.money(m.amount), f.pct(m.amount, collected)]) },
          { heading: 'Par jour', columns: ['Journée', 'Mode', 'Nombre', 'Montant'], end: [2, 3], rows: b.payments.byDay.map((p) => [f.date(p.date), PAYMENT_METHOD_LABELS[p.method], p.count, f.money(p.amount)]) },
          {
            heading: 'Paiements annulés',
            columns: ['Indicateur', 'Valeur'],
            end: [1],
            rows: [
              ['Nombre', b.payments.voidedCount],
              ['Montant', f.money(b.payments.voidedAmount)],
            ],
          },
        ],
      };
    }
    case 'kitchen': {
      const k = data.kitchen;
      if (!k) return null;
      const t = k.totals;
      return {
        title: 'Temps de préparation',
        sections: [
          {
            heading: 'Indicateurs',
            columns: ['Indicateur', 'Valeur'],
            end: [1],
            rows: [
              ['Commandes mesurées', t.measured],
              [d('Temps moyen'), f.dur(t.averageMs)],
              [d('Temps médian'), f.dur(t.medianMs)],
              [d('Plus long'), f.dur(t.maxMs)],
              ['Commandes en retard', t.lateCount],
              [d('Retard moyen'), f.dur(t.averageLateMs)],
            ],
          },
          { heading: 'Par poste', columns: ['Poste', 'Articles', d('Temps moyen'), d('Plus long'), 'En retard'], end: [1, 2, 3, 4], rows: k.byStation.map((s) => [s.name, s.items, f.dur(s.averageMs), f.dur(s.maxMs), s.lateCount]) },
          { heading: 'Par produit', columns: ['Produit', 'Portions', d('Temps moyen'), d('Prévu'), 'En retard'], end: [1, 2, 3, 4], rows: k.byProduct.map((p) => [p.name, p.quantity, f.dur(p.averageMs), f.dur(p.expectedMs), p.lateCount]) },
          {
            heading: 'Tickets en retard',
            columns: ['N°', 'Journée', 'Table', d('Durée'), d('Prévu'), d('Retard')],
            end: [0, 3, 4, 5],
            rows: k.lateTickets.map((x) => [x.number, f.date(x.businessDate), x.tableLabel ?? '—', f.dur(x.durationMs), f.dur(x.expectedMs), f.dur(x.lateMs)]),
          },
          { heading: 'Par journée', columns: ['Journée', 'Commandes', d('Temps moyen'), 'En retard'], end: [1, 2, 3], rows: k.byDay.map((x) => [f.date(x.date), x.measured, f.dur(x.averageMs), x.lateCount]) },
        ],
      };
    }
    case 'stock': {
      const s = data.stock;
      if (!s) return null;
      return {
        title: 'Stock',
        sections: [
          {
            heading: 'Articles',
            columns: ['Article', 'Unité', 'Début', 'Reçu', 'Consommé', 'Pertes', 'Sorties', 'Ajustements', 'Fin', 'Consommation', 'Valeur des pertes'],
            end: [2, 3, 4, 5, 6, 7, 8, 9, 10],
            rows: s.items.map((i) => [
              i.name,
              INVENTORY_UNIT_LABELS[i.unit],
              f.qty(i.opening),
              f.qty(i.received),
              f.qty(i.consumed),
              f.qty(i.losses),
              f.qty(i.outs),
              f.qty(i.adjustments),
              f.qty(i.closing),
              f.money(i.consumedValue),
              f.money(i.lossValue),
            ]),
          },
          {
            heading: 'Pertes, sorties et inventaires',
            columns: ['Date', 'Article', 'Type', 'Quantité', 'Unité', 'Valeur', 'Motif', 'Par'],
            end: [3, 5],
            rows: s.events.map((e) => [f.stamp(e.at), e.itemName, MOVEMENT_KIND_LABELS[e.kind], f.qty(e.quantity), INVENTORY_UNIT_LABELS[e.unit], f.money(e.value), e.reason ?? '', e.by ?? '']),
          },
        ],
      };
    }
  }
}

function DocView({ doc }: { doc: ReportDoc }) {
  return (
    <div className="report-doc">
      {doc.sections.map((s) => (
        <fieldset className="group" key={s.heading}>
          <legend>{s.heading}</legend>
          <div className="report-table-wrap">
            <table className="grid compact">
              <thead>
                <tr>
                  {s.columns.map((c, i) => (
                    <th key={c} className={s.end.includes(i) ? 'end' : undefined}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={s.columns.length}>
                      Aucune donnée sur la période
                    </td>
                  </tr>
                )}
                {s.rows.map((row, r) => (
                  <tr key={r} className={s.total && r === s.rows.length - 1 ? 'report-total' : undefined}>
                    {row.map((cell, i) => (
                      <td key={i} className={s.end.includes(i) ? 'num end' : undefined}>
                        {cell ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/** Feuille A4 : en-tête de l'établissement, titre et période, tableaux ; « Enregistrer au format PDF » donne le PDF. */
function PrintReport({ doc, me, location, period }: { doc: ReportDoc; me: Me; location: LocationDetails; period: string }) {
  return (
    <div className="print-sheet print-report">
      <header className="print-report-head">
        <div>
          <strong>{location.name}</strong>
          {me.tenant && me.tenant.name !== location.name && <span>{me.tenant.name}</span>}
          {location.address && <span>{location.address}</span>}
          {location.phone && <span>Tél. {location.phone}</span>}
        </div>
        <div className="print-report-title">
          <h1>{doc.title}</h1>
          <span>{period}</span>
        </div>
      </header>
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          <table>
            <thead>
              <tr>
                {s.columns.map((c, i) => (
                  <th key={c} className={s.end.includes(i) ? 'end' : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.length === 0 && (
                <tr>
                  <td colSpan={s.columns.length}>—</td>
                </tr>
              )}
              {s.rows.map((row, r) => (
                <tr key={r} className={s.total && r === s.rows.length - 1 ? 'report-total' : undefined}>
                  {row.map((cell, i) => (
                    <td key={i} className={s.end.includes(i) ? 'end' : undefined}>
                      {cell ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="print-report-foot">Édité le {new Date().toLocaleString('fr-FR')} · AfriKaisse</p>
    </div>
  );
}

// --- Onglet Ventes ------------------------------------------------------------------

function SalesView({ report, previous, money }: { report: SalesReport; previous: SalesReport | null; money: (v: number) => string }) {
  return (
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
  );
}

function Figure({ label, value, now, before }: { label: string; value: string; now?: number; before?: number }) {
  return (
    <div className="summary-figure">
      <dt>{label}</dt>
      <dd>
        <strong className="fig-value">{value}</strong>
        {now !== undefined && <Delta now={now} before={before} />}
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
