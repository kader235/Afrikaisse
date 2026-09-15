import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Types seulement (effacés à la compilation) : ce bundle n'embarque pas Zod.
import type { ClientSession, PublicMenu, PublicPricing, PublicProduct } from '@afrikaisse/core';
import { isTableCode } from '@afrikaisse/core/guests';
import { formatMoney } from '@afrikaisse/core/money';
import { priceLine, type PricedLine } from '@afrikaisse/core/pricing';
import { bestProductPromotion, lineDiscount, localMoment, priceOrder, promoCodeMessage, promotionBadge, type OrderPricing, type PromotionRule } from '@afrikaisse/core/promotions';
import { formatRate } from '@afrikaisse/core/taxes';
import { errorText, isNetworkError, request } from './api.ts';
import { ACTIVE_STATUSES, GuestFields, LanguageSwitch, OfflineBanner, PaySheet, Sheet, TableSheet, type Blocked, type Money } from './ClientSheets.tsx';
import { LangProvider, MONEY_LOCALE, choiceRuleText, useLang } from './i18n.tsx';
import { nicknameStore, setupPwa, tableCodeStore, useFavorites, useOnline } from './pwa.ts';
import '../styles/pricing.css';

/**
 * Menu client ouvert par le QR d'une table : consulter (même hors ligne), composer son plat,
 * commander, suivre les commandes de la table, appeler un serveur, demander l'addition.
 * Aucune application, aucun compte. Le total affiché est calculé par la même fonction que le
 * serveur, qui refait le calcul.
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
type SheetState = null | { kind: 'product'; product: PublicProduct } | { kind: 'cart' } | { kind: 'table' } | { kind: 'pay' };
interface Section {
  id: string;
  name: string;
  products: PublicProduct[];
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function randomToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => alphabet[b % 64]).join('');
}

/** Identifiant aléatoire de ce téléphone : il le relie à sa table sans compte. */
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

export function MenuApp() {
  return (
    <LangProvider>
      <Menu />
    </LangProvider>
  );
}

function Menu() {
  const { t, lang } = useLang();
  const tRef = useRef(t);
  tRef.current = t;
  const token = /^\/m\/([A-Za-z0-9_-]+)/.exec(window.location.pathname)?.[1] ?? '';
  const me = useMemo(clientToken, []);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [active, setActive] = useState<string | null>(null);
  const [cart, setCart] = useStoredCart(`afk.cart.${token}`);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [reachable, setReachable] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [favorites, toggleFavorite] = useFavorites();
  const online = useOnline();
  const [pricing, setPricing] = useState<PublicPricing | null>(null);
  const [code, setCode] = useState<PromotionRule | null>(null);

  const loadMenu = useCallback(() => {
    request<PublicMenu>('GET', `/api/public/menu/${token}`)
      .then((menu) => {
        document.title = menu.restaurant.name;
        setState({ kind: 'ready', menu });
        setActive((current) => current ?? menu.categories[0]?.id ?? null);
      })
      // Carte déjà affichée : on la garde (hors ligne, elle reste consultable).
      .catch((err: unknown) => setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'error', message: errorText(err, tRef.current) })));
  }, [token]);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: tRef.current('badLink') });
      return;
    }
    loadMenu();
    return setupPwa(token, loadMenu);
  }, [token, loadMenu]);

  // Promotions et taxes : sans elles le menu reste utilisable (prix de la carte), le serveur recalcule tout.
  useEffect(() => {
    if (token) request<PublicPricing>('GET', `/api/public/menu/${token}/pricing`).then(setPricing, () => setPricing(null));
  }, [token]);

  const loadSession = useCallback(async () => {
    if (!token) return null;
    try {
      const next = await request<ClientSession>('GET', `/api/public/menu/${token}/session?clientToken=${me}`);
      setSession(next);
      setReachable(true);
      return next;
    } catch (err) {
      if (isNetworkError(err)) setReachable(false);
      return null;
    }
  }, [token, me]);

  useEffect(() => {
    void loadSession();
  }, [loadSession, online]);

  // Suivi : relecture toutes les 8 s tant qu'une commande de ce téléphone est en cours ou qu'une
  // addition est demandée ; toutes les 30 s pour détecter le retour de la connexion ; jamais page masquée.
  const tracking = !!session && (session.orders.some((o) => o.mine && ACTIVE_STATUSES.has(o.status)) || !!session.bill);
  useEffect(() => {
    const period = !reachable ? 30_000 : tracking ? 8000 : 0;
    const onVisible = () => {
      if (!document.hidden) void loadSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    const id = period ? setInterval(onVisible, period) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (id) clearInterval(id);
    };
  }, [tracking, reachable, loadSession]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const menu = state.kind === 'ready' ? state.menu : null;
  const products = useMemo(() => new Map((menu?.categories ?? []).flatMap((c) => c.products.map((p) => [p.id, p] as const))), [menu]);

  // Sections du menu : « Populaires » (ventes réelles) et « Favoris » (ce téléphone) avant les catégories.
  const nav = useMemo<Section[]>(() => {
    if (!menu) return [];
    const extra: Section[] = [];
    const popular = (menu.popular ?? []).map((id) => products.get(id)).filter((p): p is PublicProduct => !!p);
    if (popular.length > 0) extra.push({ id: 'popular', name: t('popular'), products: popular });
    const favs = menu.categories.flatMap((c) => c.products).filter((p) => favorites.has(p.id));
    if (favs.length > 0) extra.push({ id: 'favorites', name: t('favorites'), products: favs });
    return [...extra, ...menu.categories];
  }, [menu, products, favorites, t]);

  const sections = useMemo<Section[]>(() => {
    if (!menu) return [];
    const q = normalize(query.trim());
    if (!q) return nav;
    return menu.categories
      .map((c) => ({ ...c, products: c.products.filter((p) => normalize(`${p.name} ${p.description ?? ''} ${p.tags.join(' ')}`).includes(q)) }))
      .filter((c) => c.products.length > 0);
  }, [menu, nav, query]);

  useEffect(() => {
    if (!menu || query) return;
    const onScroll = () => {
      let current = nav[0]?.id ?? null;
      for (const c of nav) {
        const el = document.getElementById(`c-${c.id}`);
        if (el && el.getBoundingClientRect().top < 140) current = c.id;
      }
      setActive(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [menu, nav, query]);

  if (state.kind === 'loading') return <div className="m-status">{t('loading')}</div>;
  if (state.kind === 'error') {
    return (
      <div className="m-status">
        <p>{state.message}</p>
        <button className="m-button" onClick={() => window.location.reload()}>
          {t('retry')}
        </button>
      </div>
    );
  }

  const { restaurant, table } = state.menu;
  const money: Money = (v) => formatMoney(v, restaurant.currency, MONEY_LOCALE[lang]);
  const offline = !online || !reachable;
  const blocked: Blocked = offline ? 'offline' : session && !session.orderingAvailable ? 'paused' : null;
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
    const result: PricedLine = product ? priceLine(product, line) : { ok: false, code: 'PRODUCT_UNAVAILABLE', message: t('removedItem') };
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
  const mine = session?.orders.filter((o) => o.mine) ?? [];
  const latest = mine.find((o) => ACTIVE_STATUSES.has(o.status));

  function addToCart(line: Omit<CartLine, 'key'>) {
    const same = cart.find((l) => l.productId === line.productId && l.variantId === line.variantId && l.note === line.note && l.modifierIds.slice().sort().join() === line.modifierIds.slice().sort().join());
    setCart(same ? cart.map((l) => (l === same ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l)) : [...cart, { ...line, key: randomToken() }]);
    setSheet(null);
    setToast(t('added'));
  }

  async function callWaiter() {
    try {
      await request('POST', `/api/public/menu/${token}/requests`, { clientToken: me, kind: 'CALL_WAITER' });
      setToast(t('waiterCalled'));
    } catch (err) {
      if (isNetworkError(err)) setReachable(false);
      setToast(errorText(err, t));
    }
  }

  function open(kind: 'table' | 'pay' | 'cart') {
    void loadSession();
    setSheet({ kind });
  }

  return (
    <div className="m-app">
      <header className="m-head">
        {restaurant.logoUrl && <img className="m-logo" src={restaurant.logoUrl} alt="" width={52} height={52} />}
        <div>
          <h1>{restaurant.name}</h1>
          {restaurant.organization !== restaurant.name && <p>{restaurant.organization}</p>}
        </div>
        <div className="m-head-side">
          <span className="m-table">{t('table', { label: table.label })}</span>
          <LanguageSwitch />
        </div>
      </header>
      <OfflineBanner blocked={blocked} />
      <div className="m-service">
        <button onClick={callWaiter} disabled={offline}>
          {t('callWaiter')}
        </button>
        <button onClick={() => open('table')}>{t('myTable')}</button>
        <button onClick={() => open('pay')}>{t('pay')}</button>
      </div>

      <div className="m-sticky">
        <label className="m-search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" />
          </svg>
          <input type="search" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('search')} />
        </label>
        {!query && (
          <nav className="m-cats">
            {nav.map((c) => (
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
          <section key={c.id} id={`c-${c.id}`} className={`m-section m-section-${c.id === 'popular' || c.id === 'favorites' ? c.id : 'category'}`}>
            <h2>{c.name}</h2>
            {c.products.map((p) => (
              <button key={p.id} className={`m-item${p.isAvailable ? '' : ' off'}${p.photoUrl ? ' has-photo' : ''}`} onClick={() => setSheet({ kind: 'product', product: p })}>
                <span className="m-text">
                  <strong>
                    {favorites.has(p.id) && <StarIcon className="m-fav-mark" filled />}
                    {p.name}
                  </strong>
                  {p.description && <span className="m-desc">{p.description}</span>}
                  <span className="m-price">
                    <PriceContent product={p} promo={showcase(p)} ht={ht(p)} money={money} />
                    {!p.isAvailable && <em>{t('soldOut')}</em>}
                  </span>
                </span>
                {p.photoUrl && <img src={p.photoUrl} alt="" loading="lazy" decoding="async" width={96} height={96} />}
                {p.isAvailable && (
                  <span className="m-plus" aria-hidden="true">
                    +
                  </span>
                )}
              </button>
            ))}
          </section>
        ))}
        {sections.length === 0 && <p className="m-empty">{query ? t('noResult') : t('emptyMenu')}</p>}
      </main>

      <footer className="m-foot">{t('footer')}</footer>

      {cartCount > 0 ? (
        <button className="m-bar" onClick={() => open('cart')}>
          <span>{cartCount > 1 ? t('cartMany', { n: cartCount }) : t('cartOne')}</span>
          <strong>{money(cartTotal)}</strong>
        </button>
      ) : (
        mine.length > 0 && (
          <button className="m-bar m-bar-soft" onClick={() => open('table')}>
            <span>{latest ? `${t('orderNo', { n: latest.number })} · ${t(`status.${latest.status}`)}` : t('myOrders')}</span>
            <strong>{t('track')}</strong>
          </button>
        )
      )}

      {toast && (
        <div className="m-toast" role="status">
          {toast}
        </div>
      )}

      {sheet?.kind === 'product' && (
        <ProductSheet product={sheet.product} promo={showcase(sheet.product)} ht={ht(sheet.product)} money={money} favorite={favorites.has(sheet.product.id)} onFavorite={() => toggleFavorite(sheet.product.id)} onAdd={addToCart} onClose={() => setSheet(null)} />
      )}
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
          session={session}
          blocked={blocked}
          onClose={() => setSheet(null)}
          onSubmit={async ({ note, tableCode, nickname }) => {
            try {
              await request('POST', `/api/public/menu/${token}/orders`, {
                clientToken: me,
                note: note.trim() || null,
                nickname: nickname.trim() || null,
                promoCode: code?.code ?? null,
                ...(tableCode && { tableCode }),
                lines: cart.map((l) => ({ productId: l.productId, variantId: l.variantId, modifierIds: l.modifierIds, quantity: l.quantity, note: l.note.trim() || null })),
              });
            } catch (err) {
              if (isNetworkError(err)) setReachable(false);
              throw err;
            }
            if (tableCode && session?.session) tableCodeStore.set(session.session.id, tableCode);
            nicknameStore.set(nickname);
            setCart([]);
            setCode(null);
            await loadSession();
            setSheet({ kind: 'table' });
          }}
        />
      )}
      {sheet?.kind === 'table' && <TableSheet session={session} token={token} me={me} money={money} blocked={blocked} onSession={setSession} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'pay' && (
        <PaySheet
          session={session}
          token={token}
          me={me}
          money={money}
          blocked={blocked}
          onClose={() => setSheet(null)}
          onDone={(message) => {
            setToast(message);
            setSheet(null);
            void loadSession();
          }}
        />
      )}
    </div>
  );
}

function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" width="16" height="16">
      <path d="M10 1.8l2.5 5.2 5.7.8-4.1 4 1 5.6L10 14.8l-5.1 2.6 1-5.6-4.1-4 5.7-.8z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function ProductSheet({
  product: p,
  promo,
  ht,
  money,
  favorite,
  onFavorite,
  onAdd,
  onClose,
}: {
  product: PublicProduct;
  promo: Showcase;
  ht: boolean;
  money: Money;
  favorite: boolean;
  onFavorite: () => void;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
  onClose: () => void;
}) {
  const { t, lang, allergen } = useLang();
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
                <button aria-label={t('less')} disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
                  −
                </button>
                <span>{quantity}</span>
                <button aria-label={t('more')} disabled={quantity >= 99} onClick={() => setQuantity(quantity + 1)}>
                  +
                </button>
              </div>
              <button className="m-button m-grow" disabled={!result.ok} onClick={() => onAdd({ productId: p.id, variantId, modifierIds, quantity, note: note.trim() })}>
                {t('add', { price: result.ok ? money(result.total - promoOff) : '—' })}
              </button>
            </div>
          </>
        ) : (
          <p className="m-unavailable">{t('soldOutNow')}</p>
        )
      }
    >
      {p.photoUrl && <img className="m-hero" src={p.photoUrl} alt="" decoding="async" />}
      <div className="m-sheet-body">
        <h3>{p.name}</h3>
        <p className="m-price big">
          <PriceContent product={p} promo={promo} ht={ht} money={money} />
        </p>
        <button className={favorite ? 'm-fav on' : 'm-fav'} aria-pressed={favorite} onClick={onFavorite}>
          <StarIcon filled={favorite} />
          <span>{favorite ? t('favoriteRemove') : t('favoriteAdd')}</span>
        </button>
        {p.description && <p className="m-long">{p.description}</p>}
        {p.tags.length > 0 && (
          <p className="m-tags">
            {p.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </p>
        )}
        {p.variants.length > 0 && (
          <fieldset className="m-group">
            <legend>
              {t('version')} <small>{t('required')}</small>
            </legend>
            {p.variants.map((v) => (
              <label key={v.id} className={v.isAvailable ? 'm-choice' : 'm-choice off'}>
                <input type="radio" name="variant" disabled={!v.isAvailable || !p.isAvailable} checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                <span>{v.name}</span>
                <span>{v.isAvailable ? delta(v.priceDelta) : t('unavailable')}</span>
              </label>
            ))}
          </fieldset>
        )}
        {p.modifierGroups.map((g) => (
          <fieldset className="m-group" key={g.id}>
            <legend>
              {g.name} <small>{choiceRuleText(lang, g.minSelect, g.maxSelect)}</small>
            </legend>
            {g.modifiers.map((m) => {
              const checked = modifierIds.includes(m.id);
              const full = g.maxSelect > 1 && !checked && modifierIds.filter((id) => g.modifiers.some((x) => x.id === id)).length >= g.maxSelect;
              return (
                <label key={m.id} className={m.isAvailable ? 'm-choice' : 'm-choice off'}>
                  <input type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={g.id} disabled={!m.isAvailable || !p.isAvailable || full} checked={checked} onChange={() => toggle(g.id, m.id)} onClick={() => g.maxSelect === 1 && checked && g.minSelect === 0 && toggle(g.id, m.id)} />
                  <span>{m.name}</span>
                  <span>{m.isAvailable ? delta(m.priceDelta) : t('unavailable')}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
        {p.allergens.length > 0 && (
          <p className="m-allergens">
            <strong>{t('allergens')}</strong> {p.allergens.map(allergen).join(', ')}
          </p>
        )}
        {p.isAvailable && (
          <label className="m-note-field">
            <span>{t('kitchenNote')}</span>
            <input maxLength={200} placeholder={t('kitchenNotePh')} value={note} onChange={(e) => setNote(e.target.value)} />
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
  code: promo,
  onCode,
  token,
  money,
  cart,
  session,
  blocked,
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
  money: Money;
  cart: CartLine[];
  session: ClientSession | null;
  blocked: Blocked;
  onChange: (cart: CartLine[]) => void;
  onSubmit: (input: { note: string; tableCode: string | null; nickname: string }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [note, setNote] = useState('');
  const [code, setCode] = useState(() => (session?.session ? (tableCodeStore.get(session.session.id) ?? '') : ''));
  const [nickname, setNickname] = useState(() => session?.nickname ?? nicknameStore.get());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = lines.some((l) => !l.result.ok);
  // Code exigé et téléphone pas encore à la table : le code part avec la première commande.
  const needsCode = !!session?.tableCodeRequired && !session.joined;
  const setQty = (key: string, quantity: number) => onChange(quantity <= 0 ? cart.filter((l) => l.key !== key) : cart.map((l) => (l.key === key ? { ...l, quantity } : l)));

  async function submit() {
    if (needsCode && !isTableCode(code)) {
      setError(session?.session ? t('errCodeRequired') : t('tableNotOpen'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ note, tableCode: needsCode ? code : null, nickname });
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t('cart')}
      onClose={onClose}
      footer={
        <>
          <CartSums quote={quote} money={money} />
          <PromoCodeField token={token} code={promo} onCode={onCode} problem={quote?.codeProblem ?? null} money={money} />
          {error && <p className="m-error">{error}</p>}
          {blocked && <p className="m-hint m-blocked">{t(blocked === 'offline' ? 'orderingOffline' : 'orderingPaused')}</p>}
          {invalid && <p className="m-hint">{t('removeFlagged')}</p>}
          <button className="m-button m-wide" disabled={busy || invalid || lines.length === 0 || !!blocked || !!quote?.codeProblem} onClick={submit}>
            {busy ? t('sending') : t('order', { price: money(total) })}
          </button>
          <p className="m-fine">{t('orderFine')}</p>
        </>
      }
    >
      <div className="m-sheet-body">
        <h3>{t('yourCart')}</h3>
        {lines.map(({ line, product, result }) => {
          const variant = product?.variants.find((v) => v.id === line.variantId);
          const options = product?.modifierGroups.flatMap((g) => g.modifiers).filter((m) => line.modifierIds.includes(m.id)) ?? [];
          return (
            <div key={line.key} className={result.ok ? 'm-line' : 'm-line bad'}>
              <div className="m-line-text">
                <strong>{product?.name ?? t('removedItem')}</strong>
                {(variant || options.length > 0) && <span>{[variant?.name, ...options.map((o) => o.name)].filter(Boolean).join(', ')}</span>}
                {line.note && <span>« {line.note} »</span>}
                {!result.ok && <em>{result.message}</em>}
              </div>
              <div className="m-line-side">
                <strong>{result.ok ? money(result.total) : '—'}</strong>
                <div className="m-qty small">
                  <button aria-label={t('less')} onClick={() => setQty(line.key, line.quantity - 1)}>
                    {line.quantity === 1 ? '✕' : '−'}
                  </button>
                  <span>{line.quantity}</span>
                  <button aria-label={t('more')} disabled={line.quantity >= 99} onClick={() => setQty(line.key, line.quantity + 1)}>
                    +
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {needsCode && !session?.session && <p className="m-hint">{t('tableNotOpen')}</p>}
        <GuestFields needsCode={needsCode} code={code} onCode={setCode} nickname={session?.joined && session.nickname ? session.nickname : nickname} onNickname={setNickname} />
        <label className="m-note-field">
          <span>{t('restaurantNote')}</span>
          <input maxLength={300} placeholder={t('restaurantNotePh')} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </Sheet>
  );
}

type Showcase = ReturnType<typeof bestProductPromotion>;

/** Prix affiché : remise de la meilleure promotion en cours, prix barré, badge ; « HT » en mode hors taxe. */
function PriceContent({ product: p, promo, ht, money }: { product: PublicProduct; promo: Showcase; ht: boolean; money: Money }) {
  const { t } = useLang();
  const base = p.promoPrice ?? p.price;
  const off = promo?.discount ?? 0;
  return (
    <>
      {money(base - off)}
      {ht && <small className="m-promo-ht">{t('exclTax')}</small>}
      {(p.promoPrice !== null || off > 0) && <s>{money(p.price)}</s>}
      {promo && <span className="m-promo-badge">{promotionBadge(promo.promotion, money)}</span>}
    </>
  );
}

/** Sous-total, promotions et, hors taxe, les taxes ajoutées. */
function CartSums({ quote, money }: { quote: OrderPricing | null; money: Money }) {
  const { t } = useLang();
  const taxes = quote?.taxMode === 'EXCLUSIVE' ? quote.taxes : [];
  if (!quote || (quote.applied.length === 0 && taxes.length === 0)) return null;
  return (
    <dl className="m-sums">
      <div>
        <dt>{t('subtotal')}</dt>
        <dd>{money(quote.subtotal)}</dd>
      </div>
      {quote.applied.map((a) => (
        <div key={a.id}>
          <dt>{a.code ? t('promoCodeNamed', { code: a.code }) : a.name}</dt>
          <dd>−{money(a.amount)}</dd>
        </div>
      ))}
      {taxes.map((x) => (
        <div key={`${x.rateId}:${x.rateBp}`}>
          <dt>
            {x.name} {formatRate(x.rateBp)}
          </dt>
          <dd>{money(x.tax)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PromoCodeField({ token, code, onCode, problem, money }: { token: string; code: PromotionRule | null; onCode: (code: PromotionRule | null) => void; problem: OrderPricing['codeProblem']; money: Money }) {
  const { t } = useLang();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (code) {
    return (
      <>
        <div className="m-code-on">
          <span>{t('promoCodeNamed', { code: code.code ?? '' })}</span>
          <button className="m-link" onClick={() => onCode(null)}>
            {t('promoRemove')}
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
            setError(errorText(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input aria-label={t('promoCode')} placeholder={t('promoCode')} autoComplete="off" autoCapitalize="characters" maxLength={30} value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} />
        <button className="m-button" disabled={busy || !value.trim()}>
          {t('promoApply')}
        </button>
      </form>
      {error && <p className="m-error">{error}</p>}
    </>
  );
}
