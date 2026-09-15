import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  MOBILE_MONEY_PROVIDERS,
  MONEY_MAX,
  ORDER_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SERVICE_TYPE_LABELS,
  cashSuggestions,
  discountAmount,
  formatMoney,
  priceLine,
  splitEvenly,
  type AdminMenu,
  type CashSession,
  type CashSessionListItem,
  type Check,
  type CurrencyCode,
  type Floor,
  type Me,
  type Order,
  type Payment,
  type PaymentMethod,
  type PricingProduct,
  type Printer,
  type Product,
  type Receipt,
} from '@afrikaisse/core';
import { api } from '../api.ts';
import { isNativeApp, mediaSrc } from '../platform.ts';
import { Dialog, ErrorMessage, Icon, MoneyInput, OkMessage, Window } from '../ui.tsx';

/**
 * Caisse, pensée pour la tablette au comptoir :
 * - Vente : produits au doigt, ticket toujours visible, envoi en cuisine ou encaissement immédiat ;
 * - Encaissement : les notes ouvertes (tables, à emporter), remise, paiement fractionné, reçu ;
 * - Caisse : fond, entrées/sorties, rapport X en direct, clôture Z avec écart.
 */

type Tab = 'sale' | 'checkout' | 'drawer';

interface TicketLine {
  key: string;
  productId: string;
  name: string;
  variantId: string | null;
  modifierIds: string[];
  detail: string;
  unitPrice: number;
  quantity: number;
  note: string | null;
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateTime = (ms: number) => new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
let keySeq = 0;
const nextKey = () => `l${++keySeq}`;

function toPricing(menu: AdminMenu, p: Product): PricingProduct {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    promoPrice: p.promoPrice,
    isAvailable: p.isAvailable,
    variants: p.variants.map((v) => ({ id: v.id, name: v.name, priceDelta: v.priceDelta, isAvailable: v.isAvailable })),
    modifierGroups: p.modifierGroupIds
      .map((id) => menu.modifierGroups.find((g) => g.id === id))
      .filter((g): g is AdminMenu['modifierGroups'][number] => !!g)
      .map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, priceDelta: m.priceDelta, isAvailable: m.isAvailable })),
      })),
  };
}

export function checkTitle(c: Check): string {
  if (c.kind === 'session') return `Table ${c.tableLabel}`;
  const o = c.orders[0]!;
  const base = c.tableLabel ? `Table ${c.tableLabel} · n°${o.number}` : `${c.serviceType === 'TAKEAWAY' ? 'À emporter' : 'Comptoir'} n°${o.number}`;
  return c.customerName ? `${base} · ${c.customerName}` : base;
}

/** Action d'une fenêtre de saisie : occupation et erreur locales (l'erreur reste visible dans la fenêtre). */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function PosPage({ me }: { me: Me }) {
  const location = me.locations[0] ?? null;
  const locationId = location?.id ?? null;
  const has = (p: Me['permissions'][number]) => me.permissions.includes(p);
  const canSell = has('orders.create');
  const canCollect = has('payments.collect');
  const [tab, setTab] = useState<Tab>(canSell ? 'sale' : 'checkout');
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [drawer, setDrawer] = useState<CashSession | null | undefined>(undefined);
  const [paying, setPaying] = useState<Check | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printing, setPrinting] = useState<ReactNode>(null);
  const [receiptPrinters, setReceiptPrinters] = useState(0);
  const currency: CurrencyCode = menu?.location.currency ?? 'XAF';

  const loadChecks = useCallback(async () => {
    if (!locationId) return;
    try {
      setChecks(await api<Check[]>('GET', `/locations/${locationId}/checks`));
    } catch (err) {
      setError(err);
    }
  }, [locationId]);

  const loadDrawer = useCallback(async () => {
    if (!locationId || !canCollect) return setDrawer(null);
    try {
      setDrawer((await api<{ session: CashSession | null }>('GET', `/locations/${locationId}/cash-session`)).session);
    } catch (err) {
      setError(err);
    }
  }, [locationId, canCollect]);

  useEffect(() => {
    if (!locationId) return;
    api<AdminMenu>('GET', `/locations/${locationId}/menu`).then(setMenu, setError);
    api<Floor>('GET', `/locations/${locationId}/floor`).then(setFloor, () => setFloor(null));
    api<Printer[]>('GET', `/locations/${locationId}/printers`).then((list) => setReceiptPrinters(list.filter((p) => p.printsReceipts).length), () => setReceiptPrinters(0));
  }, [locationId]);

  // Les notes bougent avec le service (QR, serveurs, autre caisse) : relecture régulière.
  useEffect(() => {
    void loadChecks();
    void loadDrawer();
    const id = setInterval(() => {
      if (!document.hidden) void loadChecks();
    }, 5000);
    const onVisible = () => !document.hidden && void loadChecks();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadChecks, loadDrawer]);

  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 150);
    return () => clearTimeout(timer);
  }, [printing]);

  const print = isNativeApp() ? null : (node: ReactNode) => setPrinting(node);
  const refresh = () => {
    void loadChecks();
    void loadDrawer();
  };
  const say = (text: string) => {
    setError(null);
    setNotice(text);
  };

  if (!locationId || !location) return <ErrorMessage error={new Error('Aucun établissement')} />;

  const due = (checks ?? []).filter((c) => c.remaining > 0);
  const tabs: [Tab, string, boolean][] = [
    ['sale', 'Vente', canSell],
    ['checkout', 'Encaissement', true],
    ['drawer', 'Caisse', canCollect],
  ];

  return (
    <>
      <Window className="page-pos" title="Caisse" bodyless>
        <div className="pos-bar">
          <div className="subtabs" role="tablist">
            {tabs
              .filter(([, , visible]) => visible)
              .map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-current={tab === id ? 'page' : undefined}
                  onClick={() => {
                    setTab(id);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {label}
                  {id === 'checkout' && due.length > 0 && <span className="count-pill">{due.length}</span>}
                </button>
              ))}
          </div>
          {canCollect && drawer !== undefined && (
            <div className="pos-drawer">
              {drawer ? (
                <>
                  <span className="st st-ready">Caisse ouverte</span>
                  <span className="pos-drawer-cash">Espèces {formatMoney(drawer.summary.expectedCash, currency)}</span>
                </>
              ) : (
                <>
                  <span className="st st-cancelled">Caisse fermée</span>
                  {tab !== 'drawer' && (
                    <button className="btn" onClick={() => setTab('drawer')}>
                      Ouvrir la caisse
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* En vente, les messages vont dans le ticket : rien ne doit décaler les produits sous le doigt. */}
        {tab !== 'sale' && (!!error || notice) && (
          <div className="pos-messages">
            <ErrorMessage error={error} />
            {notice && !error && <OkMessage>{notice}</OkMessage>}
          </div>
        )}

        {tab === 'sale' && (
          <SaleTab
            locationId={locationId}
            menu={menu}
            floor={floor}
            checks={checks}
            currency={currency}
            canCollect={canCollect}
            drawerOpen={!!drawer}
            error={error}
            notice={notice}
            onDismiss={() => {
              setError(null);
              setNotice(null);
            }}
            onSent={(order, payNow) => {
              say(`Commande n°${order.number} envoyée · ${formatMoney(order.total, order.currency)}`);
              void loadChecks();
              if (payNow) {
                setPaying({
                  kind: 'order',
                  id: order.id,
                  tableId: order.tableId,
                  tableLabel: order.tableLabel,
                  serviceType: order.serviceType,
                  customerName: order.customerName,
                  openedAt: order.createdAt,
                  orders: [order],
                  total: order.total,
                  paid: order.paid,
                  remaining: order.total - order.paid,
                  currency: order.currency,
                });
              }
            }}
            onError={(err) => {
              setNotice(null);
              setError(err);
            }}
          />
        )}

        {tab === 'checkout' && (
          <CheckoutTab
            checks={checks}
            floor={floor}
            me={me}
            drawerOpen={!!drawer}
            locationName={location.name}
            onPay={setPaying}
            onChanged={refresh}
            onNotice={say}
            onOpenDrawer={() => setTab('drawer')}
            print={print}
          />
        )}

        {tab === 'drawer' && (
          <DrawerTab
            locationId={locationId}
            locationName={location.name}
            drawer={drawer}
            currency={currency}
            canRefund={has('payments.refund')}
            onChanged={(next) => {
              if (next !== undefined) setDrawer(next);
              refresh();
            }}
            onNotice={say}
            onReceipt={setReceipt}
            print={print}
          />
        )}
      </Window>

      {paying && (
        <PayDialog
          locationId={locationId}
          check={paying}
          drawerOpen={!!drawer}
          onClose={() => setPaying(null)}
          onDone={(r) => {
            setPaying(null);
            setReceipt(r);
            say(`Reçu n°${r.payment.receiptNumber} · ${PAYMENT_METHOD_LABELS[r.payment.method]} ${formatMoney(r.payment.amount, r.location.currency)}`);
            refresh();
          }}
        />
      )}

      {receipt && (
        <Dialog
          title={`Reçu n°${receipt.payment.receiptNumber}`}
          onClose={() => setReceipt(null)}
          footer={
            <>
              {receiptPrinters > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      await api('POST', `/payments/${receipt.payment.id}/print`);
                      say(`Reçu n°${receipt.payment.receiptNumber} envoyé à l'imprimante de caisse.`);
                      setReceipt(null);
                    } catch (err) {
                      setError(err);
                      setReceipt(null);
                    }
                  }}
                >
                  <Icon name="print" />
                  Imprimante de caisse
                </button>
              )}
              {print && (
                <button className={receiptPrinters > 0 ? 'btn' : 'btn btn-primary'} onClick={() => print(<ReceiptTicket receipt={receipt} />)}>
                  <Icon name="print" />
                  Imprimer
                </button>
              )}
              <button className="btn" onClick={() => setReceipt(null)}>
                Fermer
              </button>
            </>
          }
        >
          <div className="ticket-preview">
            <ReceiptTicket receipt={receipt} />
          </div>
        </Dialog>
      )}

      {printing && createPortal(<div className="print-sheet print-ticket">{printing}</div>, document.body)}
    </>
  );
}

// --- Vente ------------------------------------------------------------------

/** Prise de commande au doigt. `fixedTableId` : commande pour une table précise (plan de salle du serveur). */
export function SaleTab({
  locationId,
  menu,
  floor,
  checks,
  currency,
  canCollect,
  drawerOpen,
  fixedTableId,
  error,
  notice,
  onDismiss,
  onSent,
  onError,
}: {
  locationId: string;
  menu: AdminMenu | null;
  floor: Floor | null;
  checks?: Check[] | null;
  currency: CurrencyCode;
  canCollect: boolean;
  drawerOpen?: boolean;
  fixedTableId?: string;
  error?: unknown;
  notice?: ReactNode;
  onDismiss?: () => void;
  onSent: (order: Order, payNow: boolean) => void;
  onError: (err: unknown) => void;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [serviceType, setServiceType] = useState<'DINE_IN' | 'TAKEAWAY'>('DINE_IN');
  const [tableId, setTableId] = useState(fixedTableId ?? '');
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [options, setOptions] = useState<PricingProduct | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => (menu ? [...menu.categories].sort((a, b) => a.sort - b.sort) : []), [menu]);
  const activeCategory = categoryId ?? categories[0]?.id ?? null;
  const products = useMemo(() => {
    if (!menu) return [];
    const q = query.trim().toLowerCase();
    const list = q ? menu.products.filter((p) => p.name.toLowerCase().includes(q)) : menu.products.filter((p) => p.categoryId === activeCategory);
    return [...list].sort((a, b) => a.sort - b.sort);
  }, [menu, activeCategory, query]);
  // Sans aucune photo dans la liste, des tuiles de texte : pas de cadres vides.
  const withPhotos = products.some((p) => p.photoUrl);
  const inTicket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.productId, (counts.get(l.productId) ?? 0) + l.quantity);
    return counts;
  }, [lines]);

  const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const table = floor?.tables.find((t) => t.id === (fixedTableId ?? tableId)) ?? null;
  const tableZone = table ? floor?.zones.find((z) => z.id === table.zoneId) : undefined;

  function add(line: Omit<TicketLine, 'key'>) {
    if (error || notice) onDismiss?.();
    setLines((current) => {
      const same = current.find((l) => l.productId === line.productId && l.variantId === line.variantId && l.note === line.note && [...l.modifierIds].sort().join() === [...line.modifierIds].sort().join());
      return same ? current.map((l) => (l === same ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l)) : [...current, { ...line, key: nextKey() }];
    });
  }

  function tap(p: Product) {
    if (!menu || !p.isAvailable) return;
    const pricing = toPricing(menu, p);
    if (pricing.variants.length === 0 && pricing.modifierGroups.length === 0) {
      add({ productId: p.id, name: p.name, variantId: null, modifierIds: [], detail: '', unitPrice: p.promoPrice ?? p.price, quantity: 1, note: null });
    } else {
      setOptions(pricing);
    }
  }

  const changeQty = (key: string, delta: number) => setLines((current) => current.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + delta) } : l)).filter((l) => l.quantity > 0));

  async function send(payNow: boolean) {
    setBusy(true);
    try {
      const order = await api<Order>('POST', `/locations/${locationId}/orders`, {
        serviceType,
        tableId: serviceType === 'DINE_IN' && tableId ? tableId : null,
        customerName: serviceType === 'TAKEAWAY' ? customerName.trim() || null : null,
        note: note.trim() || null,
        lines: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, modifierIds: l.modifierIds, quantity: l.quantity, note: l.note })),
      });
      setLines([]);
      setNote('');
      setNoteOpen(false);
      setCustomerName('');
      setTableId(fixedTableId ?? '');
      onSent(order, payNow);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-sale">
      <div className="pos-catalog">
        <div className="pos-browse">
          <label className="pos-search">
            <Icon name="search" />
            <input type="search" placeholder="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher un produit" />
          </label>
          <nav className="pos-cats" aria-label="Catégories">
            {!menu && <span className="muted">Chargement…</span>}
            {categories.map((c) => (
              <button
                key={c.id}
                aria-pressed={!query && activeCategory === c.id}
                onClick={() => {
                  setQuery('');
                  setCategoryId(c.id);
                }}
              >
                {c.name}
              </button>
            ))}
          </nav>
        </div>

        <div className={withPhotos ? 'pos-products' : 'pos-products pos-products-text'}>
          {menu && products.length === 0 && <p className="pos-none muted">{query ? 'Aucun produit trouvé.' : 'Aucun produit dans cette catégorie.'}</p>}
          {products.map((p) => {
            const hasOptions = p.variants.length > 0 || p.modifierGroupIds.length > 0;
            const qty = inTicket.get(p.id) ?? 0;
            return (
              <button key={p.id} className={qty > 0 ? 'pos-tile in-ticket' : 'pos-tile'} disabled={!p.isAvailable} onClick={() => tap(p)}>
                {withPhotos &&
                  (p.photoUrl ? (
                    <img className="pos-tile-photo" src={mediaSrc(p.photoUrl)} alt="" loading="lazy" />
                  ) : (
                    <span className="pos-tile-photo pos-tile-blank" aria-hidden="true">
                      <Icon name="kitchen" />
                    </span>
                  ))}
                <span className="pos-tile-name">{p.name}</span>
                <span className="pos-tile-foot">
                  <span className="pos-tile-price">{formatMoney(p.promoPrice ?? p.price, currency)}</span>
                  {!p.isAvailable ? <span className="pos-tile-tag">Épuisé</span> : hasOptions && <span className="pos-tile-tag">Options</span>}
                </span>
                {qty > 0 && (
                  <span className="pos-tile-qty" aria-label={`${qty} dans le ticket`}>
                    {qty}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <aside className="pos-ticket" aria-label="Ticket">
        <div className="pos-dest">
          {fixedTableId ? (
            <strong className="pos-fixed">Table {table?.label}</strong>
          ) : (
            <>
              <span className="segmented">
                {(['DINE_IN', 'TAKEAWAY'] as const).map((s) => (
                  <button key={s} className="btn" aria-pressed={serviceType === s} onClick={() => setServiceType(s)}>
                    {SERVICE_TYPE_LABELS[s]}
                  </button>
                ))}
              </span>
              {serviceType === 'DINE_IN' ? (
                <button type="button" className="pos-pick" disabled={!floor} onClick={() => setPicking(true)}>
                  <Icon name="table" />
                  <span className="pos-pick-text">
                    <small>{table ? tableZone?.name ?? 'Table' : 'Table'}</small>
                    <strong>{table ? `Table ${table.label}` : 'Comptoir'}</strong>
                  </span>
                  <Icon name="chevron" />
                </button>
              ) : (
                <input placeholder="Nom du client" maxLength={60} value={customerName} onChange={(e) => setCustomerName(e.target.value)} aria-label="Nom du client" />
              )}
            </>
          )}
        </div>

        <ul className="pos-lines">
          {lines.length === 0 &&
            (notice ? (
              <li className="pos-empty">
                <OkMessage>{notice}</OkMessage>
              </li>
            ) : (
              <li className="pos-empty muted">Ticket vide</li>
            ))}
          {lines.map((l) => (
            <li key={l.key} className="pos-line">
              <strong className="pos-line-name">{l.name}</strong>
              <span className="pos-line-total num">{formatMoney(l.unitPrice * l.quantity, currency)}</span>
              <div className="pos-line-detail">
                {l.detail && <span>{l.detail}</span>}
                {l.quantity > 1 && (
                  <span>
                    {l.quantity} × {formatMoney(l.unitPrice, currency)}
                  </span>
                )}
                {l.note && <span className="order-note">« {l.note} »</span>}
              </div>
              <span className="qty">
                <button className="btn" aria-label={`Retirer un ${l.name}`} onClick={() => changeQty(l.key, -1)}>
                  −
                </button>
                <span className="num">{l.quantity}</span>
                <button className="btn" aria-label={`Ajouter un ${l.name}`} onClick={() => changeQty(l.key, 1)}>
                  +
                </button>
              </span>
            </li>
          ))}
        </ul>

        <div className="pos-foot">
          {!!error && <ErrorMessage error={error} />}
          {(noteOpen || !!note) && (
            <input className="pos-note" autoFocus={!note} placeholder="Remarque pour la cuisine" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Remarque pour la cuisine" />
          )}
          <div className="pos-total">
            <span>
              Total · {count} article{count > 1 ? 's' : ''}
            </span>
            <strong>{formatMoney(total, currency)}</strong>
          </div>
          <button className="btn btn-primary pos-send" disabled={busy || lines.length === 0} onClick={() => send(false)}>
            Envoyer la commande
          </button>
          <div className="pos-tools">
            {canCollect && drawerOpen && (
              <button className="btn pos-collect" disabled={busy || lines.length === 0} onClick={() => send(true)}>
                <Icon name="cash" />
                Envoyer et encaisser
              </button>
            )}
            <button className="btn btn-icon" title="Remarque pour la cuisine" aria-label="Remarque pour la cuisine" aria-pressed={noteOpen || !!note} onClick={() => setNoteOpen((open) => !open)}>
              <Icon name="edit" />
            </button>
            <button
              className="btn btn-icon"
              title="Vider le ticket"
              aria-label="Vider le ticket"
              disabled={busy || lines.length === 0}
              onClick={() => {
                setLines([]);
                setNote('');
                setNoteOpen(false);
              }}
            >
              <Icon name="trash" />
            </button>
          </div>
        </div>
      </aside>

      {options && (
        <OptionsDialog
          product={options}
          currency={currency}
          onClose={() => setOptions(null)}
          onAdd={(line) => {
            add(line);
            setOptions(null);
          }}
        />
      )}

      {picking && floor && (
        <TablePicker
          floor={floor}
          checks={checks ?? null}
          currency={currency}
          value={tableId}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setTableId(id);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/** Choix de la table au doigt : les tables par zone, libres ou occupées (reste à payer). */
function TablePicker({ floor, checks, currency, value, onPick, onClose }: { floor: Floor; checks: Check[] | null; currency: CurrencyCode; value: string; onPick: (tableId: string) => void; onClose: () => void }) {
  const open = new Map<string, Check>();
  for (const c of checks ?? []) if (c.kind === 'session' && c.tableId) open.set(c.tableId, c);
  const zones = [...floor.zones].sort((a, b) => a.sort - b.sort);

  return (
    <Dialog
      title="Choisir la table"
      onClose={onClose}
      wide
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Annuler
        </button>
      }
    >
      <div className="dialog-body table-picker">
        <button type="button" className="pick-counter" aria-pressed={!value} onClick={() => onPick('')}>
          Comptoir, sans table
        </button>
        {zones.map((z) => {
          const tables = floor.tables.filter((t) => t.zoneId === z.id && t.status === 'ACTIVE').sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }));
          if (tables.length === 0) return null;
          return (
            <section key={z.id} className="pick-zone">
              <h3>{z.name}</h3>
              <div className="pick-grid">
                {tables.map((t) => {
                  const check = open.get(t.id);
                  return (
                    <button type="button" key={t.id} className="pick-table" aria-pressed={value === t.id} onClick={() => onPick(t.id)}>
                      <strong>{t.label}</strong>
                      <span className={check ? 'st st-progress' : 'st st-ready'}>{check ? 'Occupée' : 'Libre'}</span>
                      <small className="muted">{check ? formatMoney(check.remaining, currency) : `${t.capacity} places`}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}

function OptionsDialog({ product, currency, onAdd, onClose }: { product: PricingProduct; currency: CurrencyCode; onAdd: (line: Omit<TicketLine, 'key'>) => void; onClose: () => void }) {
  // Au comptoir, la première version disponible est proposée d'office : un toucher de moins.
  const [variantId, setVariantId] = useState<string | null>(product.variants.find((v) => v.isAvailable)?.id ?? null);
  const [modifierIds, setModifierIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const priced = priceLine(product, { variantId, modifierIds, quantity });

  function toggle(groupId: string, modifierId: string) {
    const group = product.modifierGroups.find((g) => g.id === groupId)!;
    setModifierIds((current) => {
      if (current.includes(modifierId)) return current.filter((id) => id !== modifierId);
      const inGroup = current.filter((id) => group.modifiers.some((m) => m.id === id));
      if (group.maxSelect === 1) return [...current.filter((id) => !inGroup.includes(id)), modifierId];
      if (inGroup.length >= group.maxSelect) return current;
      return [...current, modifierId];
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!priced.ok) return;
    onAdd({
      productId: product.id,
      name: product.name,
      variantId: priced.variant?.id ?? null,
      modifierIds,
      detail: [priced.variant?.name, ...priced.modifiers.map((m) => m.name)].filter(Boolean).join(', '),
      unitPrice: priced.unitPrice,
      quantity,
      note: note.trim() || null,
    });
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={product.name}
        onClose={onClose}
        wide
        footer={
          <>
            <button className="btn btn-primary" disabled={!priced.ok}>
              Ajouter · {priced.ok ? formatMoney(priced.total, currency) : '—'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body">
          {product.variants.length > 0 && (
            <fieldset className="group">
              <legend>Version</legend>
              <div className="chips">
                {product.variants.map((v) => (
                  <button type="button" key={v.id} className="chip" disabled={!v.isAvailable} aria-pressed={variantId === v.id} onClick={() => setVariantId(v.id)}>
                    {v.name}
                    {v.priceDelta !== 0 && <small> {v.priceDelta > 0 ? '+' : ''}{formatMoney(v.priceDelta, currency)}</small>}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {product.modifierGroups.map((g) => (
            <fieldset className="group" key={g.id}>
              <legend>
                {g.name}{' '}
                <small className="muted">{g.minSelect > 0 ? (g.maxSelect === 1 ? 'obligatoire' : `au moins ${g.minSelect}, jusqu'à ${g.maxSelect}`) : `facultatif, jusqu'à ${g.maxSelect}`}</small>
              </legend>
              <div className="chips">
                {g.modifiers.map((m) => (
                  <button type="button" key={m.id} className="chip" disabled={!m.isAvailable} aria-pressed={modifierIds.includes(m.id)} onClick={() => toggle(g.id, m.id)}>
                    {m.name}
                    {m.priceDelta !== 0 && <small> +{formatMoney(m.priceDelta, currency)}</small>}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="form" style={{ marginTop: 10 }}>
            <label>Quantité</label>
            <span className="qty">
              <button type="button" className="btn" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                −
              </button>
              <span className="num">{quantity}</span>
              <button type="button" className="btn" onClick={() => setQuantity((q) => Math.min(99, q + 1))}>
                +
              </button>
            </span>
            <label htmlFor="opt-note">Remarque</label>
            <input id="opt-note" maxLength={200} placeholder="Sans oignons…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {!priced.ok && <div className="msg msg-warn" style={{ marginTop: 10 }}>{priced.message}</div>}
        </div>
      </Dialog>
    </form>
  );
}

// --- Encaissement -----------------------------------------------------------

function CheckoutTab({
  checks,
  floor,
  me,
  drawerOpen,
  locationName,
  onPay,
  onChanged,
  onNotice,
  onOpenDrawer,
  print,
}: {
  checks: Check[] | null;
  floor: Floor | null;
  me: Me;
  drawerOpen: boolean;
  locationName: string;
  onPay: (check: Check) => void;
  onChanged: () => void;
  onNotice: (text: string) => void;
  onOpenDrawer: () => void;
  print: ((node: ReactNode) => void) | null;
}) {
  const has = (p: Me['permissions'][number]) => me.permissions.includes(p);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [discountFor, setDiscountFor] = useState<Order | null>(null);
  const [transfer, setTransfer] = useState(false);
  const list = checks ?? [];
  const keyOf = (c: Check) => `${c.kind}:${c.id}`;
  // Toujours une note affichée : jamais de panneau vide à côté de la liste.
  const selected = list.find((c) => keyOf(c) === selectedKey) ?? list[0] ?? null;

  return (
    <div className="pos-checkout">
      <div className="check-list" role="listbox" aria-label="Notes ouvertes">
        {checks === null && <p className="check-empty muted">Chargement…</p>}
        {checks !== null && list.length === 0 && <p className="check-empty muted">Aucune note ouverte.</p>}
        {list.map((c) => (
          <button key={keyOf(c)} role="option" aria-selected={selected === c} className="check-row" onClick={() => setSelectedKey(keyOf(c))}>
            <span className="check-row-main">
              <strong>{checkTitle(c)}</strong>
              <small className="muted">
                {hhmm(c.openedAt)} · {c.orders.length} commande{c.orders.length > 1 ? 's' : ''}
                {c.paid > 0 && ` · payé ${formatMoney(c.paid, c.currency)}`}
              </small>
            </span>
            <span className="check-row-amount">{c.remaining > 0 ? formatMoney(c.remaining, c.currency) : <span className="st st-ready">Réglée</span>}</span>
            <Icon name="chevronRight" />
          </button>
        ))}
      </div>

      {selected && (
        <aside className="check-detail" aria-label={checkTitle(selected)}>
          <div className="check-detail-head">
            <strong>{checkTitle(selected)}</strong>
            <span className="muted">Ouverte à {hhmm(selected.openedAt)}</span>
          </div>
          <div className="check-detail-body">
            {selected.orders.length === 0 && <p className="muted">Aucune commande en cours sur cette table.</p>}
            {selected.orders.map((o) => (
              <div key={o.id} className="check-order">
                <div className="order-line-head">
                  <strong>
                    Commande n°{o.number} <small className="muted">{hhmm(o.createdAt)}</small>
                  </strong>
                  <span className="muted">
                    {ORDER_STATUS_LABELS[o.status]} · {PAYMENT_STATUS_LABELS[o.paymentStatus]}
                  </span>
                </div>
                <ul className="order-lines">
                  {o.items.map((i) => (
                    <li key={i.id}>
                      <div className="order-line-head">
                        <span>
                          {i.quantity} × {i.name}
                          {i.variantName && ` (${i.variantName})`}
                        </span>
                        <span className="num">{formatMoney(i.total, o.currency)}</span>
                      </div>
                      {i.modifiers.length > 0 && <div className="muted">{i.modifiers.map((m) => m.name).join(', ')}</div>}
                    </li>
                  ))}
                  {o.discount > 0 && (
                    <li>
                      <div className="order-line-head">
                        <span>Remise{o.discountReason && ` · ${o.discountReason}`}</span>
                        <span className="num">−{formatMoney(o.discount, o.currency)}</span>
                      </div>
                    </li>
                  )}
                </ul>
                {has('orders.discount') && o.paid === 0 && o.status !== 'COMPLETED' && (
                  <button className="btn" onClick={() => setDiscountFor(o)}>
                    {o.discount > 0 ? 'Modifier la remise' : 'Remise'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="check-detail-foot">
            <div className="order-line-head">
              <span>Total</span>
              <span className="num">{formatMoney(selected.total, selected.currency)}</span>
            </div>
            {selected.paid > 0 && (
              <div className="order-line-head">
                <span>Déjà payé</span>
                <span className="num">{formatMoney(selected.paid, selected.currency)}</span>
              </div>
            )}
            <div className="check-due">
              <span>Reste à payer</span>
              <strong>{formatMoney(selected.remaining, selected.currency)}</strong>
            </div>
            <div className="check-actions">
              {has('payments.collect') &&
                (drawerOpen ? (
                  <button className="btn btn-primary" disabled={selected.remaining <= 0} onClick={() => onPay(selected)}>
                    <Icon name="cash" />
                    Encaisser
                  </button>
                ) : (
                  <button className="btn" onClick={onOpenDrawer}>
                    Ouvrir la caisse pour encaisser
                  </button>
                ))}
              {((print && selected.orders.length > 0) || (selected.kind === 'session' && has('orders.create'))) && (
                <div className="check-actions-row">
                  {print && selected.orders.length > 0 && (
                    <button className="btn" onClick={() => print(<BillTicket check={selected} locationName={locationName} />)}>
                      <Icon name="print" />
                      Addition
                    </button>
                  )}
                  {selected.kind === 'session' && has('orders.create') && (
                    <button className="btn" onClick={() => setTransfer(true)}>
                      <Icon name="move" />
                      Changer de table
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

      {discountFor && (
        <DiscountDialog
          order={discountFor}
          onClose={() => setDiscountFor(null)}
          onDone={(o) => {
            setDiscountFor(null);
            onNotice(o.discount > 0 ? `Remise de ${formatMoney(o.discount, o.currency)} sur la commande n°${o.number}.` : `Remise retirée de la commande n°${o.number}.`);
            onChanged();
          }}
        />
      )}
      {transfer && selected?.kind === 'session' && (
        <TransferDialog
          check={selected}
          floor={floor}
          occupied={new Set(list.filter((c) => c.kind === 'session').map((c) => c.tableId!))}
          onClose={() => setTransfer(false)}
          onDone={(label, merged) => {
            setTransfer(false);
            setSelectedKey(null);
            onNotice(merged ? `Additions regroupées sur la table ${label}.` : `Clients installés à la table ${label}.`);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Billets courants en FCFA : l’exact, puis les coupures rondes jusqu’au billet de 50 000. */
const CASH_NOTES = [500, 1000, 2000, 5000, 10000, 20000, 50000];

const KEYPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'back'] as const;

/**
 * Encaissement au pavé numérique : pas de clavier du système qui recouvre la fenêtre sur tablette.
 * Deux cases : le montant encaissé et, en espèces, la somme reçue ; la première touche remplace la valeur affichée.
 * Au clavier physique, chiffres, retour arrière et Entrée fonctionnent aussi.
 */
export function PayDialog({ locationId, check, drawerOpen, onDone, onClose }: { locationId: string; check: Check; drawerOpen: boolean; onDone: (r: Receipt) => void; onClose: () => void }) {
  const currency = check.currency;
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState(check.remaining);
  const [tendered, setTendered] = useState<number | null>(null);
  const [field, setField] = useState<'amount' | 'tendered'>('tendered');
  const [fresh, setFresh] = useState(true);
  const [provider, setProvider] = useState('');
  const [reference, setReference] = useState('');
  const { busy, error, run } = useAction();

  const target = method === 'CASH' ? field : 'amount';
  const given = tendered ?? amount;
  const change = method === 'CASH' ? given - amount : 0;
  const valid = amount > 0 && amount <= check.remaining && (method !== 'CASH' || given >= amount);

  function focusField(next: 'amount' | 'tendered') {
    setField(next);
    setFresh(true);
  }

  function press(key: string) {
    const current = target === 'amount' ? amount : tendered ?? 0;
    const base = fresh ? 0 : current;
    const next = key === 'back' ? Math.floor(base / 10) : key === 'clear' ? 0 : base * 10 ** key.length + Number(key);
    if (next > MONEY_MAX) return;
    setFresh(false);
    if (target === 'amount') setAmount(next);
    else setTendered(next);
  }

  function pay() {
    if (!valid || busy || !drawerOpen) return;
    void run(async () => {
      onDone(
        await api<Receipt>('POST', `/locations/${locationId}/payments`, {
          target: { kind: check.kind, id: check.id },
          method,
          amount,
          tendered: method === 'CASH' ? given : null,
          provider: method === 'MOBILE_MONEY' ? provider.trim() || null : null,
          reference: reference.trim() || null,
        }),
      );
    });
  }

  // Clavier physique : les touches alimentent le pavé, sauf pendant la saisie de la référence.
  const pressRef = useRef(press);
  const payRef = useRef(pay);
  pressRef.current = press;
  payRef.current = pay;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (/^[0-9]$/.test(e.key)) pressRef.current(e.key);
      else if (e.key === 'Backspace') pressRef.current('back');
      else if (e.key === 'Delete') pressRef.current('clear');
      else if (e.key === 'Enter') payRef.current();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const parts = [1, 2, 3, 4].map((n) => [n, splitEvenly(check.remaining, n)[0]!] as const);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        pay();
      }}
    >
      <Dialog
        title={`Encaisser — ${checkTitle(check)}`}
        onClose={onClose}
        wide
        footer={
          <>
            <button className="btn btn-primary pay-submit" disabled={!valid || busy || !drawerOpen}>
              Valider · {formatMoney(amount, currency)}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body pay">
          <ErrorMessage error={error} />
          {!drawerOpen && <div className="msg msg-warn">La caisse est fermée : ouvrez-la dans l'onglet Caisse.</div>}
          <div className="pay-grid">
            <div className="pay-side">
              <div className="pay-due">
                <span>Reste à payer</span>
                <strong>{formatMoney(check.remaining, currency)}</strong>
              </div>

              <span className="pay-label">Mode de paiement</span>
              <div className="pay-methods">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    type="button"
                    key={m}
                    className="chip"
                    aria-pressed={method === m}
                    onClick={() => {
                      setMethod(m);
                      focusField(m === 'CASH' ? 'tendered' : 'amount');
                    }}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>

              <span className="pay-label">Part de l'addition</span>
              <div className="pay-split">
                {parts.map(([n, value]) => (
                  <button
                    type="button"
                    key={n}
                    className="chip"
                    aria-pressed={amount === value && (n === 1 || value !== check.remaining)}
                    onClick={() => {
                      setAmount(value);
                      setTendered(null);
                      focusField(method === 'CASH' ? 'tendered' : 'amount');
                    }}
                  >
                    {n === 1 ? 'Tout' : `1/${n}`}
                  </button>
                ))}
              </div>

              {method === 'MOBILE_MONEY' && (
                <>
                  <span className="pay-label">Opérateur</span>
                  <div className="chips">
                    {MOBILE_MONEY_PROVIDERS.map((p) => (
                      <button type="button" key={p} className="chip" aria-pressed={provider === p} onClick={() => setProvider(provider === p ? '' : p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {method !== 'CASH' && (
                <label className="pay-ref">
                  <span className="pay-label">Référence</span>
                  <input maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'MOBILE_MONEY' ? 'N° de transaction' : 'Facultatif'} />
                </label>
              )}
            </div>

            <div className="pay-pad">
              <button type="button" className="pay-field" aria-pressed={target === 'amount'} onClick={() => focusField('amount')}>
                <span>Montant encaissé</span>
                <strong>{formatMoney(amount, currency)}</strong>
              </button>
              {method === 'CASH' && (
                <>
                  <button type="button" className="pay-field" aria-pressed={target === 'tendered'} onClick={() => focusField('tendered')}>
                    <span>Reçu du client</span>
                    <strong>{formatMoney(given, currency)}</strong>
                  </button>
                  <div className="chips pay-quick">
                    {cashSuggestions(amount, CASH_NOTES)
                      .slice(0, 4)
                      .map((v) => (
                        <button
                          type="button"
                          key={v}
                          className="chip"
                          aria-pressed={given === v}
                          onClick={() => {
                            setTendered(v);
                            focusField('tendered');
                          }}
                        >
                          {formatMoney(v, currency)}
                        </button>
                      ))}
                  </div>
                </>
              )}
              <div className="keypad">
                {KEYPAD.map((k) => (
                  <button type="button" key={k} className="keypad-key" aria-label={k === 'back' ? 'Effacer un chiffre' : undefined} onClick={() => press(k)}>
                    {k === 'back' ? <Icon name="backspace" /> : k}
                  </button>
                ))}
              </div>
              {method === 'CASH' && (
                <div className="pay-change">
                  <span>Monnaie à rendre</span>
                  <strong>{change < 0 ? 'Insuffisant' : formatMoney(change, currency)}</strong>
                </div>
              )}
            </div>
          </div>
          {amount > check.remaining && <div className="msg msg-warn pay-over">Le montant dépasse le reste à payer.</div>}
        </div>
      </Dialog>
    </form>
  );
}

function DiscountDialog({ order, onDone, onClose }: { order: Order; onDone: (o: Order) => void; onClose: () => void }) {
  const [kind, setKind] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [value, setValue] = useState<number | null>(10);
  const [valueKey, setValueKey] = useState(0);
  const [reason, setReason] = useState(order.discountReason ?? '');
  const { busy, error, run } = useAction();
  const preview = discountAmount(order.subtotal, kind, value ?? 0);

  const save = (body: object) =>
    run(async () => {
      onDone(await api<Order>('POST', `/orders/${order.id}/discount`, body));
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ kind, value: value ?? 0, reason: reason.trim() });
      }}
    >
      <Dialog
        title={`Remise — commande n°${order.number}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !reason.trim() || preview <= 0}>
              Appliquer
            </button>
            {order.discount > 0 && (
              <button type="button" className="btn" disabled={busy} onClick={() => save({ kind: 'AMOUNT', value: 0 })}>
                Retirer la remise
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="chips">
            {[5, 10, 15, 20, 50].map((p) => (
              <button
                type="button"
                key={p}
                className="chip"
                aria-pressed={kind === 'PERCENT' && value === p}
                onClick={() => {
                  setKind('PERCENT');
                  setValue(p);
                  setValueKey((k) => k + 1);
                }}
              >
                {p} %
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={kind === 'AMOUNT' && value === order.subtotal}
              onClick={() => {
                setKind('AMOUNT');
                setValue(order.subtotal);
                setValueKey((k) => k + 1);
              }}
            >
              Offert
            </button>
          </div>
          <div className="form" style={{ marginTop: 12 }}>
            <label>Type</label>
            <span className="segmented">
              <button type="button" className="btn" aria-pressed={kind === 'PERCENT'} onClick={() => setKind('PERCENT')}>
                Pourcentage
              </button>
              <button type="button" className="btn" aria-pressed={kind === 'AMOUNT'} onClick={() => setKind('AMOUNT')}>
                Montant
              </button>
            </span>
            <label htmlFor="disc-value">{kind === 'PERCENT' ? 'Pourcentage' : 'Montant'}</label>
            {kind === 'PERCENT' ? (
              <input id="disc-value" type="number" inputMode="numeric" min={1} max={100} value={value ?? ''} onChange={(e) => setValue(e.target.value === '' ? null : Math.min(100, Math.max(0, Math.round(Number(e.target.value)))))} />
            ) : (
              <MoneyInput key={valueKey} id="disc-value" value={value} currency={order.currency} required onChange={setValue} />
            )}
            <label htmlFor="disc-reason">Motif</label>
            <input id="disc-reason" required maxLength={200} placeholder="Client fidèle, erreur de service…" value={reason} onChange={(e) => setReason(e.target.value)} />
            <label>Nouveau total</label>
            <strong className="big-amount">
              {formatMoney(order.subtotal - preview, order.currency)} <small className="muted">(−{formatMoney(preview, order.currency)})</small>
            </strong>
          </div>
        </div>
      </Dialog>
    </form>
  );
}

export function TransferDialog({ check, floor, occupied, onDone, onClose }: { check: Check; floor: Floor | null; occupied: Set<string>; onDone: (label: string, merged: boolean) => void; onClose: () => void }) {
  const [tableId, setTableId] = useState('');
  const { busy, error, run } = useAction();
  const tables = (floor?.tables ?? []).filter((t) => t.id !== check.tableId).sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }));
  const target = tables.find((t) => t.id === tableId);
  const merge = !!target && occupied.has(target.id);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!target) return;
        void run(async () => {
          await api('POST', `/table-sessions/${check.id}/transfer`, { tableId });
          onDone(target.label, merge);
        });
      }}
    >
      <Dialog
        title={`Changer de table — ${checkTitle(check)}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={!target || busy}>
              {merge ? 'Regrouper' : 'Déplacer'}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="transfer-table">Nouvelle table</label>
            <select id="transfer-table" required value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">Choisir…</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  Table {t.label}
                  {occupied.has(t.id) ? ' (occupée)' : ''}
                </option>
              ))}
            </select>
          </div>
          {merge && <div className="msg msg-warn" style={{ marginTop: 10 }}>La table {target!.label} est occupée : les deux additions seront regroupées sur une seule note.</div>}
        </div>
      </Dialog>
    </form>
  );
}

// --- Session de caisse --------------------------------------------------------

function DrawerTab({
  locationId,
  locationName,
  drawer,
  currency,
  canRefund,
  onChanged,
  onNotice,
  onReceipt,
  print,
}: {
  locationId: string;
  locationName: string;
  drawer: CashSession | null | undefined;
  currency: CurrencyCode;
  canRefund: boolean;
  onChanged: (next?: CashSession | null) => void;
  onNotice: (text: string) => void;
  onReceipt: (r: Receipt) => void;
  print: ((node: ReactNode) => void) | null;
}) {
  const [float, setFloat] = useState<number | null>(0);
  const [movement, setMovement] = useState<'IN' | 'OUT' | null>(null);
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState<CashSession | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<CashSessionListItem[] | null>(null);
  const { busy, error, run } = useAction();

  const loadHistory = useCallback(() => {
    api<CashSessionListItem[]>('GET', `/locations/${locationId}/cash-sessions`).then(setHistory, () => setHistory([]));
  }, [locationId]);
  useEffect(loadHistory, [loadHistory, drawer?.id, drawer?.status]);

  if (drawer === undefined) return <div className="window-body muted">Chargement…</div>;

  const historyBlock = (
    <fieldset className="group" style={{ marginTop: 12 }}>
      <legend>Sessions précédentes</legend>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Journée</th>
              <th>Ouverture</th>
              <th>Clôture</th>
              <th>Encaissé</th>
              <th>Écart</th>
            </tr>
          </thead>
          <tbody>
            {(history ?? []).filter((h) => h.status === 'CLOSED').length === 0 && (
              <tr>
                <td className="empty" colSpan={5}>
                  Aucune session clôturée.
                </td>
              </tr>
            )}
            {(history ?? [])
              .filter((h) => h.status === 'CLOSED')
              .map((h) => (
                <tr key={h.id} className="selectable" onClick={() => void run(async () => setReport(await api<CashSession>('GET', `/cash-sessions/${h.id}`)))}>
                  <td>{h.businessDate}</td>
                  <td>
                    {dateTime(h.openedAt)} · {h.openedBy}
                  </td>
                  <td>{h.closedAt && `${dateTime(h.closedAt)} · ${h.closedBy}`}</td>
                  <td className="num">{formatMoney(h.summary.paymentsTotal, h.currency)}</td>
                  <td className="num">
                    <DifferenceText value={h.difference ?? 0} currency={h.currency} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  );

  const reportDialog = report && (
    <Dialog
      title={report.status === 'CLOSED' ? 'Rapport de clôture (Z)' : 'Rapport X'}
      onClose={() => setReport(null)}
      footer={
        <>
          {print && (
            <button className="btn btn-primary" onClick={() => print(<CashReportTicket session={report} locationName={locationName} />)}>
              <Icon name="print" />
              Imprimer
            </button>
          )}
          <button className="btn" onClick={() => setReport(null)}>
            Fermer
          </button>
        </>
      }
    >
      <div className="ticket-preview">
        <CashReportTicket session={report} locationName={locationName} />
      </div>
    </Dialog>
  );

  if (drawer === null) {
    return (
      <div className="window-body">
        <ErrorMessage error={error} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const opened = await api<CashSession>('POST', `/locations/${locationId}/cash-sessions`, { openingFloat: float ?? 0 });
              onNotice(`Caisse ouverte avec un fond de ${formatMoney(opened.openingFloat, currency)}.`);
              onChanged(opened);
            });
          }}
        >
          <fieldset className="group drawer-open">
            <legend>Ouvrir la caisse</legend>
            <div className="form">
              <label htmlFor="float">Fond de caisse</label>
              <MoneyInput id="float" value={float} currency={currency} required onChange={setFloat} />
            </div>
            <div className="order-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" disabled={busy}>
                Ouvrir la caisse
              </button>
            </div>
          </fieldset>
        </form>
        {historyBlock}
        {reportDialog}
      </div>
    );
  }

  const s = drawer.summary;
  const selected = drawer.payments.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      {!!error && (
        <div className="window-body" style={{ paddingBottom: 0 }}>
          <ErrorMessage error={error} />
        </div>
      )}
      <div className="floor">
        <div>
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Reçu</th>
                  <th>Heure</th>
                  <th>Mode</th>
                  <th>Montant</th>
                  <th>Commandes</th>
                  <th>Par</th>
                </tr>
              </thead>
              <tbody>
                {drawer.payments.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={6}>
                      Aucun encaissement depuis l'ouverture.
                    </td>
                  </tr>
                )}
                {drawer.payments.map((p) => (
                  <tr key={p.id} className={p.status === 'VOIDED' ? 'selectable voided' : 'selectable'} aria-selected={p.id === selectedId} onClick={() => setSelectedId(p.id)}>
                    <td className="num">{p.receiptNumber}</td>
                    <td className="num">{hhmm(p.createdAt)}</td>
                    <td>
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.provider && ` · ${p.provider}`}
                    </td>
                    <td className="num">{p.status === 'VOIDED' ? <s>{formatMoney(p.amount, currency)}</s> : formatMoney(p.amount, currency)}</td>
                    <td>{p.allocations.map((a) => `n°${a.orderNumber}`).join(', ')}</td>
                    <td>{p.status === 'VOIDED' ? <span className="st st-cancelled">Annulé</span> : p.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="window-body">{historyBlock}</div>
        </div>

        <aside className="floor-side">
          <fieldset className="group">
            <legend>Caisse ouverte</legend>
            <p className="muted">
              Par {drawer.openedBy} à {hhmm(drawer.openedAt)} · journée du {drawer.businessDate}
            </p>
            <dl className="kv">
              <dt>Fond de caisse</dt>
              <dd>{formatMoney(drawer.openingFloat, currency)}</dd>
              {s.byMethod.map((m) => (
                <FragmentRow key={m.method} label={`${PAYMENT_METHOD_LABELS[m.method]} (${m.count})`} value={formatMoney(m.amount, currency)} />
              ))}
              <dt>Total encaissé</dt>
              <dd>
                <strong>{formatMoney(s.paymentsTotal, currency)}</strong>
              </dd>
              {s.movementsIn > 0 && <FragmentRow label="Entrées d'espèces" value={`+${formatMoney(s.movementsIn, currency)}`} />}
              {s.movementsOut > 0 && <FragmentRow label="Sorties d'espèces" value={`−${formatMoney(s.movementsOut, currency)}`} />}
              {s.voidedCount > 0 && <FragmentRow label={`Annulés (${s.voidedCount})`} value={formatMoney(s.voidedAmount, currency)} />}
              <dt>Espèces attendues</dt>
              <dd>
                <strong>{formatMoney(s.expectedCash, currency)}</strong>
              </dd>
            </dl>
            <div className="order-actions">
              <button className="btn" onClick={() => setMovement('IN')}>
                Entrée d'espèces
              </button>
              <button className="btn" onClick={() => setMovement('OUT')}>
                Sortie d'espèces
              </button>
              <button className="btn" onClick={() => setReport(drawer)}>
                Rapport X
              </button>
              <button className="btn btn-primary" onClick={() => setClosing(true)}>
                Clôturer la caisse
              </button>
            </div>
          </fieldset>

          {selected && (
            <fieldset className="group">
              <legend>Reçu n°{selected.receiptNumber}</legend>
              <p>
                {PAYMENT_METHOD_LABELS[selected.method]} · <strong>{formatMoney(selected.amount, currency)}</strong>
                {selected.change > 0 && ` · rendu ${formatMoney(selected.change, currency)}`}
              </p>
              {selected.reference && <p className="muted">Réf. {selected.reference}</p>}
              {selected.voidReason && <div className="msg msg-warn">Annulé : {selected.voidReason}</div>}
              <div className="order-actions">
                <button className="btn" onClick={() => void run(async () => onReceipt(await api<Receipt>('GET', `/payments/${selected.id}/receipt`)))}>
                  Voir le reçu
                </button>
                {canRefund && selected.status === 'RECORDED' && (
                  <button className="btn btn-danger" onClick={() => setVoiding(selected)}>
                    Annuler le paiement
                  </button>
                )}
              </div>
            </fieldset>
          )}
        </aside>
      </div>

      {movement && (
        <MovementDialog
          kind={movement}
          session={drawer}
          onClose={() => setMovement(null)}
          onDone={(next) => {
            setMovement(null);
            onNotice(movement === 'IN' ? "Entrée d'espèces enregistrée." : "Sortie d'espèces enregistrée.");
            onChanged(next);
          }}
        />
      )}
      {closing && (
        <CloseDialog
          session={drawer}
          onClose={() => setClosing(false)}
          onDone={(closed) => {
            setClosing(false);
            setReport(closed);
            onNotice(`Caisse clôturée · écart ${formatMoney(closed.difference ?? 0, currency)}.`);
            onChanged(null);
          }}
        />
      )}
      {voiding && (
        <VoidDialog
          payment={voiding}
          currency={currency}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            onNotice(`Paiement du reçu n°${voiding.receiptNumber} annulé.`);
            onChanged();
          }}
        />
      )}
      {reportDialog}
    </>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function DifferenceText({ value, currency }: { value: number; currency: CurrencyCode }) {
  if (value === 0) return <span className="st st-ready">Juste</span>;
  return <span className={value < 0 ? 'st st-cancelled' : 'st st-pending'}>{`${value > 0 ? '+' : '−'}${formatMoney(Math.abs(value), currency)}`}</span>;
}

function MovementDialog({ kind, session, onDone, onClose }: { kind: 'IN' | 'OUT'; session: CashSession; onDone: (s: CashSession) => void; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => onDone(await api<CashSession>('POST', `/cash-sessions/${session.id}/movements`, { kind, amount, reason: reason.trim() })));
      }}
    >
      <Dialog
        title={kind === 'IN' ? "Entrée d'espèces" : "Sortie d'espèces"}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !amount || !reason.trim()}>
              Enregistrer
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="mv-amount">Montant</label>
            <MoneyInput id="mv-amount" value={amount} currency={session.currency} required onChange={setAmount} />
            <label htmlFor="mv-reason">Motif</label>
            <input id="mv-reason" required maxLength={200} placeholder={kind === 'IN' ? 'Apport de monnaie…' : 'Achat de glace, dépôt en banque…'} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

function CloseDialog({ session, onDone, onClose }: { session: CashSession; onDone: (s: CashSession) => void; onClose: () => void }) {
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const expected = session.summary.expectedCash;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => onDone(await api<CashSession>('POST', `/cash-sessions/${session.id}/close`, { countedCash: counted ?? 0, note: note.trim() || null })));
      }}
    >
      <Dialog
        title="Clôturer la caisse (Z)"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || counted === null}>
              Clôturer
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label>Espèces attendues</label>
            <strong className="big-amount">{formatMoney(expected, session.currency)}</strong>
            <label htmlFor="counted">Espèces comptées</label>
            <MoneyInput id="counted" value={counted} currency={session.currency} required onChange={setCounted} />
            <label>Écart</label>
            <span>{counted === null ? '—' : <DifferenceText value={counted - expected} currency={session.currency} />}</span>
            <label htmlFor="close-note">Remarque</label>
            <input id="close-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

function VoidDialog({ payment, currency, onDone, onClose }: { payment: Payment; currency: CurrencyCode; onDone: () => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api('POST', `/payments/${payment.id}/void`, { reason: reason.trim() });
          onDone();
        });
      }}
    >
      <Dialog
        title={`Annuler le paiement — reçu n°${payment.receiptNumber}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-danger" disabled={busy || !reason.trim()}>
              Annuler le paiement
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Retour
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <p style={{ marginBottom: 10 }}>
            {PAYMENT_METHOD_LABELS[payment.method]} · <strong>{formatMoney(payment.amount, currency)}</strong>. Les commandes concernées redeviennent à encaisser.
          </p>
          <div className="form">
            <label htmlFor="void-reason">Motif</label>
            <input id="void-reason" required maxLength={200} placeholder="Mauvais mode de paiement…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

// --- Tickets (aperçu et impression 80 mm) -------------------------------------

function Row({ left, right, strong }: { left: ReactNode; right: ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? 'ticket-row ticket-strong' : 'ticket-row'}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

function OrderLines({ order }: { order: Order }) {
  const money = (v: number) => formatMoney(v, order.currency);
  return (
    <>
      <div className="ticket-strong">
        Commande n°{order.number}
        {order.tableLabel ? ` · Table ${order.tableLabel}` : ` · ${SERVICE_TYPE_LABELS[order.serviceType]}`}
      </div>
      {order.items.map((i) => (
        <div key={i.id}>
          <Row left={`${i.quantity} × ${i.name}${i.variantName ? ` (${i.variantName})` : ''}`} right={money(i.total)} />
          {i.modifiers.length > 0 && <div className="ticket-small">  {i.modifiers.map((m) => m.name).join(', ')}</div>}
        </div>
      ))}
      {order.discount > 0 && <Row left={`Remise${order.discountReason ? ` (${order.discountReason})` : ''}`} right={`−${money(order.discount)}`} />}
    </>
  );
}

export function ReceiptTicket({ receipt }: { receipt: Receipt }) {
  const { payment, location } = receipt;
  const money = (v: number) => formatMoney(v, location.currency);
  const total = receipt.orders.reduce((s, o) => s + o.total, 0);
  return (
    <div className="ticket">
      <div className="ticket-center">
        {location.logoUrl && <img className="ticket-logo" src={mediaSrc(location.logoUrl)} alt="" />}
        <div className="ticket-strong ticket-big">{location.name}</div>
        {receipt.organization !== location.name && <div>{receipt.organization}</div>}
        {location.address && <div>{location.address}</div>}
        {location.phone && <div>Tél. {location.phone}</div>}
      </div>
      <hr />
      <Row left={`Reçu n°${String(payment.receiptNumber).padStart(6, '0')}`} right={dateTime(payment.createdAt)} strong />
      {receipt.cashier && <div>Caissier : {receipt.cashier}</div>}
      {payment.status === 'VOIDED' && <div className="ticket-void">PAIEMENT ANNULÉ</div>}
      <hr />
      {receipt.orders.map((o) => (
        <OrderLines key={o.id} order={o} />
      ))}
      <hr />
      <Row left="Total" right={money(total)} strong />
      <Row left={`Payé · ${PAYMENT_METHOD_LABELS[payment.method]}${payment.provider ? ` ${payment.provider}` : ''}`} right={money(payment.amount)} />
      {payment.method === 'CASH' && payment.tendered > payment.amount && (
        <>
          <Row left="Remis" right={money(payment.tendered)} />
          <Row left="Rendu" right={money(payment.change)} />
        </>
      )}
      {payment.reference && <div className="ticket-small">Réf. {payment.reference}</div>}
      {receipt.remaining > 0 ? <Row left="Reste à payer" right={money(receipt.remaining)} strong /> : <div className="ticket-center ticket-strong">Réglé — merci</div>}
      <hr />
      <div className="ticket-center ticket-small">Merci de votre visite · AfriKaisse</div>
    </div>
  );
}

export function BillTicket({ check, locationName }: { check: Check; locationName: string }) {
  const money = (v: number) => formatMoney(v, check.currency);
  return (
    <div className="ticket">
      <div className="ticket-center">
        <div className="ticket-strong ticket-big">{locationName}</div>
        <div>ADDITION · {checkTitle(check)}</div>
        <div>{dateTime(Date.now())}</div>
      </div>
      <hr />
      {check.orders.map((o) => (
        <OrderLines key={o.id} order={o} />
      ))}
      <hr />
      <Row left="Total" right={money(check.total)} strong />
      {check.paid > 0 && <Row left="Déjà payé" right={money(check.paid)} />}
      <Row left="Reste à payer" right={money(check.remaining)} strong />
      <hr />
      <div className="ticket-center ticket-small">Ce document n'est pas un reçu.</div>
    </div>
  );
}

function CashReportTicket({ session, locationName }: { session: CashSession; locationName: string }) {
  const money = (v: number) => formatMoney(v, session.currency);
  const s = session.summary;
  return (
    <div className="ticket">
      <div className="ticket-center">
        <div className="ticket-strong ticket-big">{locationName}</div>
        <div className="ticket-strong">{session.status === 'CLOSED' ? 'RAPPORT Z — CLÔTURE' : 'RAPPORT X — EN COURS'}</div>
        <div>Journée du {session.businessDate}</div>
      </div>
      <hr />
      <Row left="Ouverture" right={`${dateTime(session.openedAt)}`} />
      <div className="ticket-small">par {session.openedBy}</div>
      {session.closedAt && (
        <>
          <Row left="Clôture" right={dateTime(session.closedAt)} />
          <div className="ticket-small">par {session.closedBy}</div>
        </>
      )}
      {!session.closedAt && <Row left="Édité le" right={dateTime(Date.now())} />}
      <hr />
      {s.byMethod.length === 0 && <div>Aucun encaissement.</div>}
      {s.byMethod.map((m) => (
        <Row key={m.method} left={`${PAYMENT_METHOD_LABELS[m.method]} (${m.count})`} right={money(m.amount)} />
      ))}
      <Row left={`Total encaissé (${s.paymentCount})`} right={money(s.paymentsTotal)} strong />
      {s.voidedCount > 0 && <Row left={`Paiements annulés (${s.voidedCount})`} right={money(s.voidedAmount)} />}
      <hr />
      <Row left="Fond de caisse" right={money(session.openingFloat)} />
      <Row left="Ventes en espèces" right={money(s.cashPayments)} />
      {session.movements.map((m) => (
        <Row key={m.id} left={`${m.kind === 'IN' ? 'Entrée' : 'Sortie'} · ${m.reason}`} right={`${m.kind === 'IN' ? '+' : '−'}${money(m.amount)}`} />
      ))}
      <Row left="Espèces attendues" right={money(s.expectedCash)} strong />
      {session.countedCash !== null && (
        <>
          <Row left="Espèces comptées" right={money(session.countedCash)} />
          <Row left="Écart" right={`${(session.difference ?? 0) > 0 ? '+' : ''}${money(session.difference ?? 0)}`} strong />
        </>
      )}
      {session.note && <div className="ticket-small">Remarque : {session.note}</div>}
    </div>
  );
}
