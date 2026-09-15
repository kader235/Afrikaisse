import { useCallback, useEffect, useMemo, useState } from 'react';
// Types seulement (effacés à la compilation) : ce bundle n'embarque pas Zod.
import type { PublicMenu, PublicOrder, PublicPricing, PublicProduct } from '@afrikaisse/core';
import { formatMoney } from '@afrikaisse/core/money';
import { priceLine, type PricedLine } from '@afrikaisse/core/pricing';
import { bestProductPromotion, lineDiscount, localMoment, priceOrder, promoCodeMessage, promotionBadge, type OrderPricing, type PromotionRule } from '@afrikaisse/core/promotions';
import { formatRate } from '@afrikaisse/core/taxes';
import { ALLERGEN_LABELS, choiceRule } from '../allergens.ts';
import '../styles/pricing.css';

/**
 * Menu client ouvert par le QR d'une table : consulter, composer son plat, commander,
 * suivre sa commande, appeler un serveur. Aucune application, aucun compte.
 * Le total affiché est calculé par la même fonction que le serveur, qui refait le calcul.
 */

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; menu: PublicMenu };
interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  modifierIds: string[];
  quantity: number;
  note: string;
}
type Sheet = null | { kind: 'product'; product: PublicProduct } | { kind: 'cart' } | { kind: 'orders' };

const STEPS = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'] as const;
const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Envoyée — en attente de confirmation',
  CONFIRMED: 'Confirmée par le restaurant',
  PREPARING: 'En préparation',
  READY: 'Prête — elle arrive',
  SERVED: 'Servie',
  COMPLETED: 'Terminée',
  CANCELLED: 'Annulée par le restaurant',
};
const STEP_LABEL = ['Envoyée', 'Confirmée', 'En cuisine', 'Prête', 'Servie'];
const ACTIVE = new Set(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED']);

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function randomToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => alphabet[b % 64]).join('');
}

/** Identifiant aléatoire de ce téléphone : lui seul peut suivre ses commandes. */
function clientToken(): string {
  try {
    let value = localStorage.getItem('afk.client');
    if (!value || !/^[A-Za-z0-9_-]{16,64}$/.test(value)) {
      value = randomToken();
      localStorage.setItem('afk.client', value);
    }
    return value;
  } catch {
    return randomToken();
  }
}

function useStoredCart(key: string): [CartLine[], (next: CartLine[]) => void] {
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]') as CartLine[];
    } catch {
      return [];
    }
  });
  const save = useCallback(
    (next: CartLine[]) => {
      setCart(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* panier gardé pour la visite seulement */
      }
    },
    [key],
  );
  return [cart, save];
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Connexion impossible. Vérifiez votre connexion Internet puis réessayez.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? 'Le restaurant ne répond pas pour le moment.');
  return data as T;
}

export function MenuApp() {
  const token = /^\/m\/([A-Za-z0-9_-]+)/.exec(window.location.pathname)?.[1] ?? '';
  const me = useMemo(clientToken, []);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [active, setActive] = useState<string | null>(null);
  const [cart, setCart] = useStoredCart(`afk.cart.${token}`);
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PublicPricing | null>(null);
  const [code, setCode] = useState<PromotionRule | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Adresse de menu incomplète. Scannez à nouveau le QR code de votre table.' });
      return;
    }
    request<PublicMenu>('GET', `/api/public/menu/${token}`)
      .then((menu) => {
        document.title = `${menu.restaurant.name} — Menu`;
        setState({ kind: 'ready', menu });
        setActive(menu.categories[0]?.id ?? null);
      })
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }, [token]);

  const loadOrders = useCallback(() => {
    request<PublicOrder[]>('GET', `/api/public/menu/${token}/orders?clientToken=${me}`).then(setOrders, () => undefined);
  }, [token, me]);
  useEffect(() => {
    if (token) loadOrders();
  }, [token, loadOrders]);

  // Promotions et taxes : sans elles le menu reste utilisable (prix de la carte), le serveur recalcule tout.
  useEffect(() => {
    if (token) request<PublicPricing>('GET', `/api/public/menu/${token}/pricing`).then(setPricing, () => setPricing(null));
  }, [token]);

  // Suivi : tant qu'une commande est en cours, on relit toutes les 6 s (sauf page masquée),
  // et aussitôt que le client revient sur la page (téléphone déverrouillé, onglet repris).
  const hasActive = orders.some((o) => ACTIVE.has(o.status));
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => {
      if (!document.hidden) loadOrders();
    }, 6000);
    const onVisible = () => {
      if (!document.hidden) loadOrders();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasActive, loadOrders]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const menu = state.kind === 'ready' ? state.menu : null;
  const products = useMemo(() => new Map((menu?.categories ?? []).flatMap((c) => c.products.map((p) => [p.id, p] as const))), [menu]);
  const sections = useMemo(() => {
    if (!menu) return [];
    const q = normalize(query.trim());
    if (!q) return menu.categories;
    return menu.categories
      .map((c) => ({ ...c, products: c.products.filter((p) => normalize(`${p.name} ${p.description ?? ''} ${p.tags.join(' ')}`).includes(q)) }))
      .filter((c) => c.products.length > 0);
  }, [menu, query]);

  useEffect(() => {
    if (!menu || query) return;
    const onScroll = () => {
      let current = menu.categories[0]?.id ?? null;
      for (const c of menu.categories) {
        const el = document.getElementById(`c-${c.id}`);
        if (el && el.getBoundingClientRect().top < 140) current = c.id;
      }
      setActive(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [menu, query]);

  if (state.kind === 'loading') return <div className="m-status">Chargement du menu…</div>;
  if (state.kind === 'error') {
    return (
      <div className="m-status">
        <p>{state.message}</p>
        <button className="m-button" onClick={() => window.location.reload()}>
          Réessayer
        </button>
      </div>
    );
  }

  const { restaurant, table } = state.menu;
  const money = (v: number) => formatMoney(v, restaurant.currency);
  const moment = pricing ? localMoment(Date.now(), pricing.timezone) : null;
  const rateOf = (productId: string) => {
    const id = pricing?.productTaxRates[productId];
    return (id && pricing?.taxRates.find((r) => r.id === id)) || null;
  };
  const showcase = (p: PublicProduct) =>
    pricing && moment && p.promoPrice === null ? bestProductPromotion(pricing.promotions, { productId: p.id, categoryId: pricing.productCategories[p.id] ?? null, unitPrice: p.price, promoPriced: false }, moment) : null;
  const ht = (p: PublicProduct) => pricing?.taxMode === 'EXCLUSIVE' && !!rateOf(p.id);
  const priced = cart.map((line) => {
    const product = products.get(line.productId);
    const result: PricedLine = product ? priceLine(product, line) : { ok: false, code: 'PRODUCT_UNAVAILABLE', message: "Cet article n'est plus au menu." };
    return { line, product, result };
  });
  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const quote: OrderPricing | null =
    pricing && moment
      ? priceOrder({
          lines: priced.flatMap(({ line, product, result }) =>
            result.ok && product ? [{ productId: line.productId, categoryId: pricing.productCategories[line.productId] ?? null, unitPrice: result.unitPrice, quantity: line.quantity, promoPriced: product.promoPrice !== null, taxRate: rateOf(line.productId) }] : [],
          ),
          promotions: pricing.promotions,
          code,
          moment,
          taxMode: pricing.taxMode,
        })
      : null;
  const cartTotal = quote ? quote.total : priced.reduce((sum, p) => sum + (p.result.ok ? p.result.total : 0), 0);
  const latest = orders.find((o) => ACTIVE.has(o.status));

  function addToCart(line: Omit<CartLine, 'key'>) {
    const same = cart.find((l) => l.productId === line.productId && l.variantId === line.variantId && l.note === line.note && l.modifierIds.slice().sort().join() === line.modifierIds.slice().sort().join());
    setCart(same ? cart.map((l) => (l === same ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l)) : [...cart, { ...line, key: randomToken() }]);
    setSheet(null);
    setToast('Ajouté au panier');
  }

  async function callStaff(kind: 'CALL_WAITER' | 'BILL') {
    try {
      await request('POST', `/api/public/menu/${token}/requests`, { clientToken: me, kind });
      setToast(kind === 'BILL' ? "L'addition a été demandée." : 'Un serveur a été prévenu.');
    } catch (err) {
      setToast((err as Error).message);
    }
  }

  return (
    <div className="m-app">
      <header className="m-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {restaurant.logoUrl && <img src={restaurant.logoUrl} alt="" width={52} height={52} style={{ flex: 'none', objectFit: 'contain', borderRadius: 8, background: '#ffffff' }} />}
          <div>
            <h1>{restaurant.name}</h1>
            {restaurant.organization !== restaurant.name && <p>{restaurant.organization}</p>}
          </div>
        </div>
        <span className="m-table">Table {table.label}</span>
      </header>
      <div className="m-service">
        <button onClick={() => callStaff('CALL_WAITER')}>Appeler un serveur</button>
        <button onClick={() => callStaff('BILL')}>Demander l'addition</button>
      </div>

      <div className="m-sticky">
        <label className="m-search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" />
          </svg>
          <input type="search" placeholder="Rechercher un plat, une boisson…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher" />
        </label>
        {!query && (
          <nav className="m-cats">
            {state.menu.categories.map((c) => (
              <button
                key={c.id}
                className={active === c.id ? 'on' : undefined}
                onClick={() => {
                  setActive(c.id);
                  document.getElementById(`c-${c.id}`)?.scrollIntoView();
                }}
              >
                {c.name}
              </button>
            ))}
          </nav>
        )}
      </div>

      <main>
        {sections.map((c) => (
          <section key={c.id} id={`c-${c.id}`} className="m-section">
            <h2>{c.name}</h2>
            {c.products.map((p) => (
              <button key={p.id} className={`m-item${p.isAvailable ? '' : ' off'}${p.photoUrl ? ' has-photo' : ''}`} onClick={() => setSheet({ kind: 'product', product: p })}>
                <span className="m-text">
                  <strong>{p.name}</strong>
                  {p.description && <span className="m-desc">{p.description}</span>}
                  <span className="m-price">
                    <PriceContent product={p} promo={showcase(p)} ht={ht(p)} money={money} />
                    {!p.isAvailable && <em>Épuisé</em>}
                  </span>
                </span>
                {p.photoUrl && <img src={p.photoUrl} alt="" loading="lazy" width={96} height={96} />}
                {p.isAvailable && (
                  <span className="m-plus" aria-hidden="true">
                    +
                  </span>
                )}
              </button>
            ))}
          </section>
        ))}
        {sections.length === 0 && <p className="m-empty">{query ? 'Aucun résultat pour cette recherche.' : "Le menu n'est pas encore disponible."}</p>}
      </main>

      <footer className="m-foot">Menu AfriKaisse</footer>

      {cartCount > 0 ? (
        <button className="m-bar" onClick={() => setSheet({ kind: 'cart' })}>
          <span>Voir le panier · {cartCount} article{cartCount > 1 ? 's' : ''}</span>
          <strong>{money(cartTotal)}</strong>
        </button>
      ) : (
        orders.length > 0 && (
          <button
            className="m-bar m-bar-soft"
            onClick={() => {
              loadOrders();
              setSheet({ kind: 'orders' });
            }}
          >
            <span>{latest ? `Commande n°${latest.number} · ${STATUS_TEXT[latest.status]}` : 'Mes commandes'}</span>
            <strong>Suivre</strong>
          </button>
        )
      )}

      {toast && (
        <div className="m-toast" role="status">
          {toast}
        </div>
      )}

      {sheet?.kind === 'product' && <ProductSheet product={sheet.product} promo={showcase(sheet.product)} ht={ht(sheet.product)} money={money} onAdd={addToCart} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'cart' && (
        <CartSheet
          lines={priced}
          total={cartTotal}
          quote={quote}
          code={code}
          onCode={setCode}
          token={token}
          money={money}
          onChange={setCart}
          cart={cart}
          onClose={() => setSheet(null)}
          onSubmit={async (note) => {
            const order = await request<PublicOrder>('POST', `/api/public/menu/${token}/orders`, {
              clientToken: me,
              note: note.trim() || null,
              promoCode: code?.code ?? null,
              lines: cart.map((l) => ({ productId: l.productId, variantId: l.variantId, modifierIds: l.modifierIds, quantity: l.quantity, note: l.note.trim() || null })),
            });
            setCart([]);
            setCode(null);
            setOrders([order, ...orders]);
            setSheet({ kind: 'orders' });
          }}
        />
      )}
      {sheet?.kind === 'orders' && <OrdersSheet orders={orders} money={money} onClose={() => setSheet(null)} />}
    </div>
  );
}

function Sheet({ title, onClose, children, footer }: { title?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="m-overlay" onClick={onClose}>
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <button className="m-close" aria-label="Fermer" onClick={onClose}>
          ✕
        </button>
        <div className="m-sheet-scroll">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

type Showcase = ReturnType<typeof bestProductPromotion>;

/** Prix affiché : remise de la meilleure promotion en cours, prix barré, badge ; « HT » en mode hors taxe. */
function PriceContent({ product: p, promo, ht, money }: { product: PublicProduct; promo: Showcase; ht: boolean; money: (v: number) => string }) {
  const base = p.promoPrice ?? p.price;
  const off = promo?.discount ?? 0;
  return (
    <>
      {money(base - off)}
      {ht && <small className="m-promo-ht">HT</small>}
      {(p.promoPrice !== null || off > 0) && <s>{money(p.price)}</s>}
      {promo && <span className="m-promo-badge">{promotionBadge(promo.promotion, money)}</span>}
    </>
  );
}

function ProductSheet({ product: p, promo, ht, money, onAdd, onClose }: { product: PublicProduct; promo: Showcase; ht: boolean; money: (v: number) => string; onAdd: (line: Omit<CartLine, 'key'>) => void; onClose: () => void }) {
  const firstVariant = p.variants.find((v) => v.isAvailable)?.id ?? null;
  const [variantId, setVariantId] = useState<string | null>(firstVariant);
  const [modifierIds, setModifierIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const result = priceLine(p, { variantId, modifierIds, quantity });
  const promoOff = promo && result.ok ? lineDiscount(promo.promotion, result.unitPrice, quantity, result.total) : 0;
  const delta = (v: number) => (v === 0 ? '' : `${v > 0 ? '+' : '−'} ${money(Math.abs(v))}`);

  function toggle(groupId: string, modifierId: string) {
    const group = p.modifierGroups.find((g) => g.id === groupId)!;
    const inGroup = modifierIds.filter((id) => group.modifiers.some((m) => m.id === id));
    if (modifierIds.includes(modifierId)) {
      setModifierIds(modifierIds.filter((id) => id !== modifierId));
    } else if (group.maxSelect === 1) {
      setModifierIds([...modifierIds.filter((id) => !inGroup.includes(id)), modifierId]);
    } else if (inGroup.length < group.maxSelect) {
      setModifierIds([...modifierIds, modifierId]);
    }
  }

  return (
    <Sheet
      title={p.name}
      onClose={onClose}
      footer={
        p.isAvailable ? (
          <>
            {!result.ok && <p className="m-hint">{result.message}</p>}
            <div className="m-add">
              <div className="m-qty">
                <button aria-label="Moins" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
                  −
                </button>
                <span>{quantity}</span>
                <button aria-label="Plus" disabled={quantity >= 99} onClick={() => setQuantity(quantity + 1)}>
                  +
                </button>
              </div>
              <button className="m-button m-grow" disabled={!result.ok} onClick={() => onAdd({ productId: p.id, variantId, modifierIds, quantity, note: note.trim() })}>
                Ajouter · {result.ok ? money(result.total - promoOff) : '—'}
              </button>
            </div>
          </>
        ) : (
          <p className="m-unavailable">Épuisé pour le moment</p>
        )
      }
    >
      {p.photoUrl && <img className="m-hero" src={p.photoUrl} alt="" />}
      <div className="m-sheet-body">
        <h3>{p.name}</h3>
        <p className="m-price big">
          <PriceContent product={p} promo={promo} ht={ht} money={money} />
        </p>
        {p.description && <p className="m-long">{p.description}</p>}
        {p.tags.length > 0 && (
          <p className="m-tags">
            {p.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </p>
        )}
        {p.variants.length > 0 && (
          <fieldset className="m-group">
            <legend>
              Version <small>obligatoire</small>
            </legend>
            {p.variants.map((v) => (
              <label key={v.id} className={v.isAvailable ? 'm-choice' : 'm-choice off'}>
                <input type="radio" name="variant" disabled={!v.isAvailable || !p.isAvailable} checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                <span>{v.name}</span>
                <span>{v.isAvailable ? delta(v.priceDelta) : 'épuisé'}</span>
              </label>
            ))}
          </fieldset>
        )}
        {p.modifierGroups.map((g) => (
          <fieldset className="m-group" key={g.id}>
            <legend>
              {g.name} <small>{choiceRule(g.minSelect, g.maxSelect)}</small>
            </legend>
            {g.modifiers.map((m) => {
              const checked = modifierIds.includes(m.id);
              const full = g.maxSelect > 1 && !checked && modifierIds.filter((id) => g.modifiers.some((x) => x.id === id)).length >= g.maxSelect;
              return (
                <label key={m.id} className={m.isAvailable ? 'm-choice' : 'm-choice off'}>
                  <input type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={g.id} disabled={!m.isAvailable || !p.isAvailable || full} checked={checked} onChange={() => toggle(g.id, m.id)} onClick={() => g.maxSelect === 1 && checked && g.minSelect === 0 && toggle(g.id, m.id)} />
                  <span>{m.name}</span>
                  <span>{m.isAvailable ? delta(m.priceDelta) : 'épuisé'}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
        {p.allergens.length > 0 && (
          <p className="m-allergens">
            <strong>Allergènes :</strong> {p.allergens.map((a) => ALLERGEN_LABELS[a]).join(', ')}
          </p>
        )}
        {p.isAvailable && (
          <label className="m-note-field">
            <span>Une précision pour la cuisine ?</span>
            <input maxLength={200} placeholder="Sans oignons, bien chaud…" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
      </div>
    </Sheet>
  );
}

function CartSheet({
  lines,
  total,
  quote,
  code,
  onCode,
  token,
  money,
  cart,
  onChange,
  onSubmit,
  onClose,
}: {
  lines: { line: CartLine; product: PublicProduct | undefined; result: PricedLine }[];
  total: number;
  quote: OrderPricing | null;
  code: PromotionRule | null;
  onCode: (code: PromotionRule | null) => void;
  token: string;
  money: (v: number) => string;
  cart: CartLine[];
  onChange: (cart: CartLine[]) => void;
  onSubmit: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = lines.some((l) => !l.result.ok);
  const setQty = (key: string, quantity: number) => onChange(quantity <= 0 ? cart.filter((l) => l.key !== key) : cart.map((l) => (l.key === key ? { ...l, quantity } : l)));

  return (
    <Sheet
      title="Panier"
      onClose={onClose}
      footer={
        <>
          <CartSums quote={quote} money={money} />
          <PromoCodeField token={token} code={code} onCode={onCode} problem={quote?.codeProblem ?? null} money={money} />
          {error && <p className="m-error">{error}</p>}
          {invalid && <p className="m-hint">Retirez les articles signalés pour commander.</p>}
          <button
            className="m-button m-wide"
            disabled={busy || invalid || lines.length === 0 || !!quote?.codeProblem}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSubmit(note);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Envoi…' : `Commander · ${money(total)}`}
          </button>
          <p className="m-fine">Votre commande est envoyée au restaurant, qui la confirme.</p>
        </>
      }
    >
      <div className="m-sheet-body">
        <h3>Votre panier</h3>
        {lines.map(({ line, product, result }) => {
          const variant = product?.variants.find((v) => v.id === line.variantId);
          const options = product?.modifierGroups.flatMap((g) => g.modifiers).filter((m) => line.modifierIds.includes(m.id)) ?? [];
          return (
            <div key={line.key} className={result.ok ? 'm-line' : 'm-line bad'}>
              <div className="m-line-text">
                <strong>{product?.name ?? 'Article retiré'}</strong>
                {(variant || options.length > 0) && <span>{[variant?.name, ...options.map((o) => o.name)].filter(Boolean).join(', ')}</span>}
                {line.note && <span>« {line.note} »</span>}
                {!result.ok && <em>{result.message}</em>}
              </div>
              <div className="m-line-side">
                <strong>{result.ok ? money(result.total) : '—'}</strong>
                <div className="m-qty small">
                  <button aria-label="Moins" onClick={() => setQty(line.key, line.quantity - 1)}>
                    {line.quantity === 1 ? '✕' : '−'}
                  </button>
                  <span>{line.quantity}</span>
                  <button aria-label="Plus" disabled={line.quantity >= 99} onClick={() => setQty(line.key, line.quantity + 1)}>
                    +
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <label className="m-note-field">
          <span>Un mot pour le restaurant ?</span>
          <input maxLength={300} placeholder="Nous sommes pressés, anniversaire…" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </Sheet>
  );
}

/** Sous-total, promotions et, hors taxe, les taxes ajoutées. */
function CartSums({ quote, money }: { quote: OrderPricing | null; money: (v: number) => string }) {
  const taxes = quote?.taxMode === 'EXCLUSIVE' ? quote.taxes : [];
  if (!quote || (quote.applied.length === 0 && taxes.length === 0)) return null;
  return (
    <dl className="m-sums">
      <div>
        <dt>Sous-total</dt>
        <dd>{money(quote.subtotal)}</dd>
      </div>
      {quote.applied.map((a) => (
        <div key={a.id}>
          <dt>{a.code ? `Code ${a.code}` : a.name}</dt>
          <dd>−{money(a.amount)}</dd>
        </div>
      ))}
      {taxes.map((t) => (
        <div key={`${t.rateId}:${t.rateBp}`}>
          <dt>
            {t.name} {formatRate(t.rateBp)}
          </dt>
          <dd>{money(t.tax)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PromoCodeField({ token, code, onCode, problem, money }: { token: string; code: PromotionRule | null; onCode: (code: PromotionRule | null) => void; problem: OrderPricing['codeProblem']; money: (v: number) => string }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (code) {
    return (
      <>
        <div className="m-code-on">
          <span>
            Code <strong>{code.code}</strong>
          </span>
          <button className="m-link" onClick={() => onCode(null)}>
            Retirer
          </button>
        </div>
        {problem && <p className="m-error">{promoCodeMessage(problem, money)}</p>}
      </>
    );
  }
  return (
    <>
      <form
        className="m-code"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onCode(await request<PromotionRule>('POST', `/api/public/menu/${token}/promo-code`, { code: value.trim() }));
            setValue('');
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input aria-label="Code promo" placeholder="Code promo" autoComplete="off" autoCapitalize="characters" maxLength={30} value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} />
        <button className="m-button" disabled={busy || !value.trim()}>
          Appliquer
        </button>
      </form>
      {error && <p className="m-error">{error}</p>}
    </>
  );
}

function OrdersSheet({ orders, money, onClose }: { orders: PublicOrder[]; money: (v: number) => string; onClose: () => void }) {
  return (
    <Sheet title="Mes commandes" onClose={onClose}>
      <div className="m-sheet-body">
        <h3>Mes commandes</h3>
        {orders.map((o) => {
          const step = STEPS.indexOf(o.status as (typeof STEPS)[number]);
          return (
            <div key={o.id} className="m-order">
              <div className="m-order-head">
                <strong>Commande n°{o.number}</strong>
                <span>{money(o.total)}</span>
              </div>
              <p className={o.status === 'CANCELLED' ? 'm-order-status bad' : 'm-order-status'}>{STATUS_TEXT[o.status]}</p>
              {o.status !== 'CANCELLED' && o.status !== 'COMPLETED' && (
                <ol className="m-steps">
                  {STEP_LABEL.map((label, i) => (
                    <li key={label} className={i <= step ? 'done' : undefined}>
                      <span />
                      {label}
                    </li>
                  ))}
                </ol>
              )}
              <ul className="m-order-items">
                {o.items.map((i, index) => (
                  <li key={index}>
                    {i.quantity} × {i.name}
                    {i.variantName && ` (${i.variantName})`}
                    {i.modifiers.length > 0 && <small> — {i.modifiers.join(', ')}</small>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {orders.length === 0 && <p className="m-empty">Aucune commande pour le moment.</p>}
      </div>
    </Sheet>
  );
}
