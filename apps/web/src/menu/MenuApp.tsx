import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Types seulement (effacés à la compilation) : ce bundle n'embarque pas Zod.
import type { ClientSession, PublicAnnouncement, PublicMenu, PublicPricing, PublicProduct } from '@afrikaisse/core';
import { isTableCode } from '@afrikaisse/core/guests';
import { formatMoney } from '@afrikaisse/core/money';
import { priceLine, type PricedLine } from '@afrikaisse/core/pricing';
import { bestProductPromotion, isScheduled, lineDiscount, localMoment, priceOrder, promoCodeMessage, promotionBadge, type OrderPricing, type PromotionRule } from '@afrikaisse/core/promotions';
import { formatRate } from '@afrikaisse/core/taxes';
import { mdiArrowLeft, mdiBellRing, mdiCash, mdiClockOutline, mdiHeart, mdiHeartOutline, mdiInformationOutline, mdiMagnify, mdiMinus, mdiPlus, mdiReceipt, mdiSilverwareForkKnife, mdiTableFurniture, mdiTrashCanOutline } from '@mdi/js';
import { useDishPhoto } from '../dishPhotos.ts';
import { Announcements } from './Announcements.tsx';
import { errorText, isNetworkError, request } from './api.ts';
import { ACTIVE_STATUSES, ChoiceRow, GuestFields, LanguageSwitch, OfflineBanner, PaySheet, Sheet, TableSheet, type Blocked, type Money } from './ClientSheets.tsx';
import { Icon } from './Icon.tsx';
import { LangProvider, MONEY_LOCALE, choiceRuleText, useLang } from './i18n.tsx';
import { MemoryGameSheet, type MemoryPhoto } from './MemoryGame.tsx';
import { nicknameStore, setupPwa, tableCodeStore, useFavorites, useOnline } from './pwa.ts';
import { sloganSize, sloganText } from './slogan.ts';
import { applyMenuTheme } from './theme.ts';
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
type SheetState = null | { kind: 'product'; product: PublicProduct } | { kind: 'cart' } | { kind: 'table' } | { kind: 'pay' } | { kind: 'game' };
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

/** Heure courante, relue chaque minute : les annonces suivent leur période tant que le menu reste ouvert. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function withSamplePhotos(menu: PublicMenu, photo: (name: string) => string | null): PublicMenu {
  return { ...menu, categories: menu.categories.map((c) => ({ ...c, products: c.products.map((p) => (p.photoUrl ? p : { ...p, photoUrl: photo(p.name) })) })) };
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
  const [loadedState, setState] = useState<State>({ kind: 'loading' });
  // Plats sans photo : photo d'exemple du catalogue livré avec l'application ; une vraie photo n'est jamais remplacée.
  const samplePhoto = useDishPhoto();
  const state = useMemo<State>(() => (loadedState.kind === 'ready' ? { kind: 'ready', menu: withSamplePhotos(loadedState.menu, samplePhoto) } : loadedState), [loadedState, samplePhoto]);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [cart, setCart] = useStoredCart(`afk.cart.${token}`);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [reachable, setReachable] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [favorites, toggleFavorite] = useFavorites();
  const online = useOnline();
  const [pricing, setPricing] = useState<PublicPricing | null>(null);
  const [code, setCode] = useState<PromotionRule | null>(null);
  const now = useMinute();
  const pinsRef = useRef<HTMLElement | null>(null);

  const loadMenu = useCallback(() => {
    request<PublicMenu>('GET', `/api/public/menu/${token}`)
      .then((menu) => {
        document.title = menu.restaurant.name;
        applyMenuTheme(menu.restaurant.theme, token);
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
  // Jeu du mémo ouvert : suivi aussi, pour annoncer « commande prête » (même passée par un autre convive de la table).
  const tracking = !!session && (session.orders.some((o) => o.mine && ACTIVE_STATUSES.has(o.status)) || !!session.bill || sheet?.kind === 'game');
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
  const popular = useMemo(() => (menu?.popular ?? []).map((id) => products.get(id)).filter((p): p is PublicProduct => !!p), [menu, products]);
  const favs = useMemo(() => (menu?.categories ?? []).flatMap((c) => c.products).filter((p) => favorites.has(p.id)), [menu, favorites]);
  // Cartes du jeu du mémo : vraies photos des plats d'abord, puis photos d'exemple du catalogue.
  const gamePhotos = useMemo<MemoryPhoto[]>(() => {
    if (loadedState.kind !== 'ready') return [];
    const all = loadedState.menu.categories.flatMap((c) => c.products);
    const real = all.flatMap((p) => (p.photoUrl ? [{ url: p.photoUrl, name: p.name }] : []));
    const samples = all.flatMap((p) => {
      const url = p.photoUrl ? null : samplePhoto(p.name);
      return url ? [{ url, name: p.name }] : [];
    });
    return [...real, ...samples];
  }, [loadedState, samplePhoto]);

  // Navigation : « Les plus commandés » (ventes réelles) et « Favoris » (ce téléphone) avant les catégories.
  const nav = useMemo<Section[]>(() => {
    if (!menu) return [];
    const extra: Section[] = [];
    if (popular.length > 0) extra.push({ id: 'popular', name: t('popular'), products: popular });
    if (favs.length > 0) extra.push({ id: 'favorites', name: t('favorites'), products: favs });
    return [...extra, ...menu.categories];
  }, [menu, popular, favs, t]);

  // Listes de plats : les favoris puis chaque catégorie (les plus commandés défilent à part).
  const sections = useMemo<Section[]>(() => {
    if (!menu) return [];
    const q = normalize(query.trim());
    if (!q) return nav.filter((s) => s.id !== 'popular');
    return menu.categories
      .map((c) => ({ ...c, products: c.products.filter((p) => normalize(`${p.name} ${p.description ?? ''} ${p.tags.join(' ')}`).includes(q)) }))
      .filter((c) => c.products.length > 0);
  }, [menu, nav, query]);

  useEffect(() => {
    if (!menu || query) {
      setPinned(false);
      return;
    }
    const onScroll = () => {
      let current = nav[0]?.id ?? null;
      for (const c of nav) {
        const el = document.getElementById(`c-${c.id}`);
        if (el && el.getBoundingClientRect().top < 120) current = c.id;
      }
      setActive(current);
      const cats = document.getElementById('m-cats');
      setPinned(!!cats && cats.getBoundingClientRect().bottom < 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [menu, nav, query]);

  // Onglet actif gardé visible dans la barre épinglée.
  useEffect(() => {
    if (!pinned || !active) return;
    const el = pinsRef.current?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pinned, active]);

  if (state.kind === 'loading') {
    return (
      <div className="m-status">
        <span className="m-spinner" aria-hidden="true" />
        <p>{t('loading')}</p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="m-status">
        <div className="m-status-card">
          <Icon path={mdiInformationOutline} size={32} />
          <p>{state.message}</p>
          <button className="m-button" onClick={() => window.location.reload()}>
            {t('retry')}
          </button>
        </div>
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
  // Pendant le jeu : commande prête (la mienne d'abord), relue par le suivi toutes les 8 s.
  const readyOrder = mine.find((o) => o.status === 'READY') ?? session?.orders.find((o) => o.status === 'READY') ?? null;

  // Annonces en cours dans le fuseau de l'établissement ; sans ce fuseau (tarifs pas encore chargés), aucune.
  const announcementMoment = pricing ? localMoment(now, pricing.timezone) : null;
  const announcements = announcementMoment
    ? (state.menu.announcements ?? [])
        .filter((a) => isScheduled(a.schedule, announcementMoment))
        .map((a) => (a.target && (a.target.kind === 'PRODUCT' ? products.has(a.target.id) : state.menu.categories.some((c) => c.id === a.target!.id)) ? a : { ...a, target: null }))
    : [];
  const evening = (() => {
    const hour = new Date(now).getHours();
    return hour >= 17 || hour < 4;
  })();
  const thumbOf = (list: PublicProduct[]) => list.find((p) => p.photoUrl)?.photoUrl ?? null;
  const popularPhotos = popular.some((p) => p.photoUrl);

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

  function goTo(id: string) {
    setActive(id);
    document.getElementById(`c-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  }

  function openAnnouncement(a: PublicAnnouncement) {
    if (!a.target) return;
    if (a.target.kind === 'CATEGORY') goTo(a.target.id);
    else {
      const product = products.get(a.target.id);
      if (product) setSheet({ kind: 'product', product });
    }
  }

  const openProduct = (p: PublicProduct) => setSheet({ kind: 'product', product: p });

  return (
    <div className="m-app">
      <header className="m-top">
        <div className="m-brand">
          {restaurant.logoUrl && <img className="m-logo" src={restaurant.logoUrl} alt="" width={44} height={44} />}
          <div className="m-brand-text">
            <small>{t('welcome')}</small>
            <strong>{restaurant.name}</strong>
          </div>
        </div>
        <div className="m-top-side">
          <LanguageSwitch />
          <button className="m-table-chip" onClick={() => open('table')}>
            <Icon path={mdiTableFurniture} size={18} />
            <span>{t('table', { label: table.label })}</span>
          </button>
        </div>
      </header>

      {restaurant.slogan ? (
        // Slogan saisi par le restaurant, tel quel ; sa langue peut différer de celle du menu.
        <h1 className={`m-greeting m-slogan m-slogan-${sloganSize(restaurant.slogan)}`} dir="auto">
          {sloganText(restaurant.slogan)}
        </h1>
      ) : (
        <h1 className="m-greeting">
          {t('greetingStart')}
          <em>{t('greetingWord')}</em>
          {t(evening ? 'greetingEndEvening' : 'greetingEnd')}
        </h1>
      )}

      <label className="m-search">
        <Icon path={mdiMagnify} size={22} />
        <input type="search" placeholder={t('search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('search')} />
      </label>

      <OfflineBanner blocked={blocked} />

      {!query && (
        <>
          <Announcements items={announcements} onOpen={openAnnouncement} />

          {(favs.length > 0 || state.menu.categories.length > 0) && (
            <>
              <div className="m-title">
                <h2>{t('categories')}</h2>
              </div>
              <nav className="m-cats" id="m-cats">
                {favs.length > 0 && (
                  <button className={active === 'favorites' ? 'm-cat on' : 'm-cat'} onClick={() => goTo('favorites')}>
                    <span className="m-cat-thumb m-cat-icon">
                      <Icon path={mdiHeart} size={24} />
                    </span>
                    <span className="m-cat-name">{t('favorites')}</span>
                  </button>
                )}
                {state.menu.categories.map((c) => {
                  const thumb = thumbOf(c.products);
                  return (
                    <button key={c.id} className={active === c.id ? 'm-cat on' : 'm-cat'} onClick={() => goTo(c.id)}>
                      {thumb ? (
                        <img className="m-cat-thumb" src={thumb} alt="" loading="lazy" decoding="async" width={56} height={56} />
                      ) : (
                        <span className="m-cat-thumb m-cat-icon">
                          <Icon path={mdiSilverwareForkKnife} size={24} />
                        </span>
                      )}
                      <span className="m-cat-name">{c.name}</span>
                    </button>
                  );
                })}
              </nav>
            </>
          )}

          {popular.length > 0 && (
            <section id="c-popular" className="m-section m-section-popular">
              <div className="m-title">
                <h2>{t('mostOrdered')}</h2>
              </div>
              <div className={popularPhotos ? 'm-pops' : 'm-pops m-pops-text'}>
                {popular.map((p) => (
                  <button key={p.id} className={p.isAvailable ? 'm-pop' : 'm-pop off'} onClick={() => openProduct(p)}>
                    {popularPhotos &&
                      (p.photoUrl ? (
                        <img className="m-pop-photo" src={p.photoUrl} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span className="m-pop-photo m-pop-empty">
                          <Icon path={mdiSilverwareForkKnife} size={30} />
                        </span>
                      ))}
                    <span className="m-pop-body">
                      <strong className="m-name">{p.name}</strong>
                      {p.description && <span className="m-desc">{p.description}</span>}
                      <span className="m-pop-foot">
                        <span className="m-price">
                          <PriceContent product={p} promo={showcase(p)} ht={ht(p)} money={money} />
                          {!p.isAvailable && <em>{t('soldOut')}</em>}
                        </span>
                        {p.isAvailable && (
                          <span className="m-plus" aria-hidden="true">
                            <Icon path={mdiPlus} size={22} />
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {!query && pinned && nav.length > 1 && (
        <nav className="m-pins" ref={pinsRef}>
          {nav.map((c) => (
            <button key={c.id} data-id={c.id} className={active === c.id ? 'on' : undefined} onClick={() => goTo(c.id)}>
              {c.name}
            </button>
          ))}
        </nav>
      )}

      <main>
        {sections.map((c) => (
          <section key={c.id} id={`c-${c.id}`} className={`m-section m-section-${c.id === 'favorites' ? c.id : 'category'}`}>
            <div className="m-title">
              <h2>{c.name}</h2>
            </div>
            <div className="m-list">
              {c.products.map((p) => (
                <button key={p.id} className={`m-item${p.isAvailable ? '' : ' off'}${p.photoUrl ? ' has-photo' : ''}`} onClick={() => openProduct(p)}>
                  {p.photoUrl && <img className="m-item-photo" src={p.photoUrl} alt="" loading="lazy" decoding="async" width={84} height={84} />}
                  <span className="m-text">
                    <strong className="m-name">
                      {favorites.has(p.id) && <Icon path={mdiHeart} size={15} className="m-fav-mark" />}
                      {p.name}
                    </strong>
                    {p.description && <span className="m-desc">{p.description}</span>}
                    <span className="m-price">
                      <PriceContent product={p} promo={showcase(p)} ht={ht(p)} money={money} />
                      {!p.isAvailable && <em>{t('soldOut')}</em>}
                    </span>
                  </span>
                  {p.isAvailable && (
                    <span className="m-plus" aria-hidden="true">
                      <Icon path={mdiPlus} size={22} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && <p className="m-empty">{query ? t('noResult') : t('emptyMenu')}</p>}
      </main>

      <footer className="m-foot">{t('footer')}</footer>

      <div className="m-dock">
        {cartCount > 0 ? (
          <button className="m-bar" onClick={() => open('cart')} aria-label={`${cartCount > 1 ? t('cartMany', { n: cartCount }) : t('cartOne')} · ${money(cartTotal)}`}>
            <span className="m-bar-label">
              <i>{cartCount}</i>
              {t('viewCart')}
            </span>
            <strong className="m-num">{money(cartTotal)}</strong>
          </button>
        ) : (
          mine.length > 0 && (
            <button className="m-bar m-bar-soft" onClick={() => open('table')}>
              <span className="m-bar-label">
                <Icon path={mdiClockOutline} size={20} />
                <span className="m-bar-status">{latest ? `${t('orderNo', { n: latest.number })} · ${t(`status.${latest.status}`)}` : t('myOrders')}</span>
              </span>
              <strong>{t('track')}</strong>
            </button>
          )
        )}
        <nav className="m-tabs">
          <button className={sheet?.kind !== 'table' && sheet?.kind !== 'game' && sheet?.kind !== 'pay' ? 'on' : undefined} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <Icon path={mdiSilverwareForkKnife} size={24} />
            <span>{t('navMenu')}</span>
          </button>
          <button className={sheet?.kind === 'table' || sheet?.kind === 'game' ? 'on' : undefined} onClick={() => open('table')}>
            <Icon path={mdiReceipt} size={24} />
            <span>{t('myTable')}</span>
          </button>
          <button onClick={callWaiter} disabled={offline} aria-label={t('callWaiter')}>
            <Icon path={mdiBellRing} size={24} />
            <span>{t('navWaiter')}</span>
          </button>
          <button className={sheet?.kind === 'pay' ? 'on' : undefined} onClick={() => open('pay')} aria-label={t('pay')}>
            <Icon path={mdiCash} size={24} />
            <span>{t('navBill')}</span>
          </button>
        </nav>
      </div>

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
      {sheet?.kind === 'table' && <TableSheet session={session} token={token} me={me} money={money} blocked={blocked} onSession={setSession} onPlay={() => setSheet({ kind: 'game' })} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'game' && (
        <MemoryGameSheet
          photos={gamePhotos}
          readyOrder={readyOrder?.number ?? null}
          onReady={() => open('table')}
          onClose={() => open('table')}
        />
      )}
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

  const actions = (
    <>
      <button className="m-round m-back" aria-label={t('back')} onClick={onClose}>
        <Icon path={mdiArrowLeft} size={22} className="m-flip" />
      </button>
      <button className={favorite ? 'm-round m-heart on' : 'm-round m-heart'} aria-pressed={favorite} aria-label={favorite ? t('favoriteRemove') : t('favoriteAdd')} onClick={onFavorite}>
        <Icon path={favorite ? mdiHeart : mdiHeartOutline} size={22} />
      </button>
    </>
  );

  return (
    <Sheet
      title={p.name}
      onClose={onClose}
      className={p.photoUrl ? 'm-sheet-product has-photo' : 'm-sheet-product'}
      closeButton={false}
      footer={
        p.isAvailable ? (
          <>
            {!result.ok && <p className="m-hint">{result.message}</p>}
            <div className="m-add">
              <div className="m-qty">
                <button aria-label={t('less')} disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
                  <Icon path={mdiMinus} size={20} />
                </button>
                <span className="m-num">{quantity}</span>
                <button aria-label={t('more')} disabled={quantity >= 99} onClick={() => setQuantity(quantity + 1)}>
                  <Icon path={mdiPlus} size={20} />
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
      {p.photoUrl ? (
        <div className="m-hero">
          <img src={p.photoUrl} alt="" decoding="async" />
          {actions}
        </div>
      ) : (
        <div className="m-hero-bar">{actions}</div>
      )}
      <div className="m-sheet-body m-product">
        <h3>{p.name}</h3>
        <p className="m-price big">
          <PriceContent product={p} promo={promo} ht={ht} money={money} />
        </p>
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
              <span className="m-group-head">
                <span>{t('version')}</span>
                <small className="req">{t('required')}</small>
              </span>
            </legend>
            {p.variants.map((v) => (
              <ChoiceRow key={v.id} type="radio" name="variant" off={!v.isAvailable} disabled={!v.isAvailable || !p.isAvailable} checked={variantId === v.id} onChange={() => setVariantId(v.id)} label={v.name} aside={v.isAvailable ? delta(v.priceDelta) : t('unavailable')} />
            ))}
          </fieldset>
        )}
        {p.modifierGroups.map((g) => (
          <fieldset className="m-group" key={g.id}>
            <legend>
              <span className="m-group-head">
                <span>{g.name}</span>
                <small className={g.minSelect > 0 ? 'req' : undefined}>{choiceRuleText(lang, g.minSelect, g.maxSelect)}</small>
              </span>
            </legend>
            {g.modifiers.map((m) => {
              const checked = modifierIds.includes(m.id);
              const full = g.maxSelect > 1 && !checked && modifierIds.filter((id) => g.modifiers.some((x) => x.id === id)).length >= g.maxSelect;
              return (
                <ChoiceRow
                  key={m.id}
                  type={g.maxSelect === 1 ? 'radio' : 'checkbox'}
                  name={g.id}
                  off={!m.isAvailable}
                  disabled={!m.isAvailable || !p.isAvailable || full}
                  checked={checked}
                  onChange={() => toggle(g.id, m.id)}
                  onClick={() => g.maxSelect === 1 && checked && g.minSelect === 0 && toggle(g.id, m.id)}
                  label={m.name}
                  aside={m.isAvailable ? delta(m.priceDelta) : t('unavailable')}
                />
              );
            })}
          </fieldset>
        ))}
        {p.allergens.length > 0 && (
          <p className="m-allergens">
            <Icon path={mdiInformationOutline} size={18} />
            <span>
              <strong>{t('allergens')}</strong> {p.allergens.map(allergen).join(', ')}
            </span>
          </p>
        )}
        {p.isAvailable && (
          <label className="m-field">
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
        <div className="m-lines">
          {lines.map(({ line, product, result }) => {
            const variant = product?.variants.find((v) => v.id === line.variantId);
            const options = product?.modifierGroups.flatMap((g) => g.modifiers).filter((m) => line.modifierIds.includes(m.id)) ?? [];
            return (
              <div key={line.key} className={result.ok ? 'm-line' : 'm-line bad'}>
                {product?.photoUrl && <img className="m-line-photo" src={product.photoUrl} alt="" loading="lazy" decoding="async" width={52} height={52} />}
                <div className="m-line-text">
                  <strong>{product?.name ?? t('removedItem')}</strong>
                  {(variant || options.length > 0) && <span>{[variant?.name, ...options.map((o) => o.name)].filter(Boolean).join(', ')}</span>}
                  {line.note && <span>« {line.note} »</span>}
                  {!result.ok && <em>{result.message}</em>}
                  <b className="m-line-price m-num">{result.ok ? money(result.total) : '—'}</b>
                </div>
                <div className="m-qty small">
                  <button aria-label={t('less')} onClick={() => setQty(line.key, line.quantity - 1)}>
                    <Icon path={line.quantity === 1 ? mdiTrashCanOutline : mdiMinus} size={18} />
                  </button>
                  <span className="m-num">{line.quantity}</span>
                  <button aria-label={t('more')} disabled={line.quantity >= 99} onClick={() => setQty(line.key, line.quantity + 1)}>
                    <Icon path={mdiPlus} size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {needsCode && !session?.session && <p className="m-hint">{t('tableNotOpen')}</p>}
        <GuestFields needsCode={needsCode} code={code} onCode={setCode} nickname={session?.joined && session.nickname ? session.nickname : nickname} onNickname={setNickname} />
        <label className="m-field">
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
      <span className="m-num">{money(base - off)}</span>
      {ht && <small className="m-promo-ht">{t('exclTax')}</small>}
      {(p.promoPrice !== null || off > 0) && <s className="m-num">{money(p.price)}</s>}
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
        <dd className="m-num">{money(quote.subtotal)}</dd>
      </div>
      {quote.applied.map((a) => (
        <div key={a.id}>
          <dt>{a.code ? t('promoCodeNamed', { code: a.code }) : a.name}</dt>
          <dd className="m-num">−{money(a.amount)}</dd>
        </div>
      ))}
      {taxes.map((x) => (
        <div key={`${x.rateId}:${x.rateBp}`}>
          <dt>
            {x.name} {formatRate(x.rateBp)}
          </dt>
          <dd className="m-num">{money(x.tax)}</dd>
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
