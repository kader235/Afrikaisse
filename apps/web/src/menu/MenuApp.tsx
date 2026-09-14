import { useEffect, useMemo, useState } from 'react';
// Types seulement (effacés à la compilation) : ce bundle n'embarque pas Zod.
import type { PublicMenu, PublicProduct } from '@afrikaisse/core';
import { formatMoney } from '@afrikaisse/core/money';
import { ALLERGEN_LABELS, choiceRule } from '../allergens.ts';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; menu: PublicMenu };

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Menu client ouvert par le QR d'une table : aucune application à installer, aucun compte.
 * Phase 3 : consultation. Le panier et la commande arrivent en phase 4.
 */
export function MenuApp() {
  const token = /^\/m\/([A-Za-z0-9_-]+)/.exec(window.location.pathname)?.[1] ?? '';
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PublicProduct | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Adresse de menu incomplète. Scannez à nouveau le QR code de votre table.' });
      return;
    }
    fetch(`/api/public/menu/${token}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error?.message ?? 'Menu indisponible pour le moment.');
        const menu = data as PublicMenu;
        document.title = `${menu.restaurant.name} — Menu`;
        setState({ kind: 'ready', menu });
        setActive(menu.categories[0]?.id ?? null);
      })
      .catch((err: unknown) =>
        setState({
          kind: 'error',
          message: err instanceof TypeError ? 'Connexion impossible. Vérifiez votre connexion Internet puis réessayez.' : (err as Error).message,
        }),
      );
  }, [token]);

  const menu = state.kind === 'ready' ? state.menu : null;
  const sections = useMemo(() => {
    if (!menu) return [];
    const q = normalize(query.trim());
    if (!q) return menu.categories;
    return menu.categories
      .map((c) => ({ ...c, products: c.products.filter((p) => normalize(`${p.name} ${p.description ?? ''} ${p.tags.join(' ')}`).includes(q)) }))
      .filter((c) => c.products.length > 0);
  }, [menu, query]);

  // Catégorie en cours de lecture : mise en évidence dans la barre du haut.
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

  return (
    <div className="m-app">
      <header className="m-head">
        <div>
          <h1>{restaurant.name}</h1>
          {restaurant.organization !== restaurant.name && <p>{restaurant.organization}</p>}
        </div>
        <span className="m-table">Table {table.label}</span>
      </header>

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
              <button key={p.id} className={p.isAvailable ? 'm-item' : 'm-item off'} onClick={() => setOpen(p)}>
                <span className="m-text">
                  <strong>{p.name}</strong>
                  {p.description && <span className="m-desc">{p.description}</span>}
                  <span className="m-price">
                    {money(p.promoPrice ?? p.price)}
                    {p.promoPrice !== null && <s>{money(p.price)}</s>}
                    {!p.isAvailable && <em>Épuisé</em>}
                  </span>
                </span>
                {p.photoUrl && <img src={p.photoUrl} alt="" loading="lazy" width={88} height={88} />}
              </button>
            ))}
          </section>
        ))}
        {sections.length === 0 && <p className="m-empty">{query ? 'Aucun résultat pour cette recherche.' : "Le menu n'est pas encore disponible."}</p>}
      </main>

      <footer className="m-foot">Menu AfriKaisse</footer>

      {open && <ProductSheet product={open} money={money} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ProductSheet({ product: p, money, onClose }: { product: PublicProduct; money: (v: number) => string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  const delta = (v: number) => (v === 0 ? '' : `${v > 0 ? '+' : '−'} ${money(Math.abs(v))}`);

  return (
    <div className="m-overlay" onClick={onClose}>
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label={p.name} onClick={(e) => e.stopPropagation()}>
        <button className="m-close" aria-label="Fermer" onClick={onClose}>
          ✕
        </button>
        {p.photoUrl && <img className="m-hero" src={p.photoUrl} alt="" />}
        <div className="m-sheet-body">
          <h3>{p.name}</h3>
          <p className="m-price big">
            {money(p.promoPrice ?? p.price)}
            {p.promoPrice !== null && <s>{money(p.price)}</s>}
          </p>
          {!p.isAvailable && <p className="m-unavailable">Épuisé pour le moment</p>}
          {p.description && <p className="m-long">{p.description}</p>}
          {p.tags.length > 0 && (
            <p className="m-tags">
              {p.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </p>
          )}
          {p.variants.length > 0 && (
            <div className="m-group">
              <h4>Versions</h4>
              <ul>
                {p.variants.map((v) => (
                  <li key={v.id} className={v.isAvailable ? undefined : 'off'}>
                    <span>{v.name}</span>
                    <span>{v.isAvailable ? delta(v.priceDelta) : 'épuisé'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.modifierGroups.map((g) => (
            <div className="m-group" key={g.id}>
              <h4>
                {g.name} <small>{choiceRule(g.minSelect, g.maxSelect)}</small>
              </h4>
              <ul>
                {g.modifiers.map((m) => (
                  <li key={m.id} className={m.isAvailable ? undefined : 'off'}>
                    <span>{m.name}</span>
                    <span>{m.isAvailable ? delta(m.priceDelta) : 'épuisé'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {p.allergens.length > 0 && (
            <p className="m-allergens">
              <strong>Allergènes :</strong> {p.allergens.map((a) => ALLERGEN_LABELS[a]).join(', ')}
            </p>
          )}
          <p className="m-note">Pour commander, adressez-vous à un serveur.</p>
        </div>
      </div>
    </div>
  );
}
