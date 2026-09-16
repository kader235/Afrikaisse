import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatMoney,
  uuidv7,
  type AdminMenu,
  type Announcement,
  type Check,
  type CurrencyCode,
  type DiningTable,
  type Floor,
  type LocationDetails,
  type Me,
  type Order,
  type PricingConfig,
  type PricingProduct,
  type Product,
} from '@afrikaisse/core';
import type { ActivityFeed } from '../activity.ts';
import { api } from '../api.ts';
import { dropQueuedOrder, isOffline, queueOrder, readCache, saveCache, useQueuedOrders } from '../offline.ts';
import { useDishPhoto } from '../dishPhotos.ts';
import { mediaSrc } from '../platform.ts';
import { ServiceHeader } from '../serviceHeader.tsx';
import { ErrorMessage, Icon } from '../ui.tsx';
import { zoneVars } from '../zoneColors.ts';
import { OptionsDialog, nextKey, ticketPricing, toPricing, type TicketLine } from './Pos.tsx';
import '../styles/take-order.css';

/**
 * Prise de commande à la tablette, pensée pour un serveur peu habitué aux écrans :
 * la table, les plats, « Envoyer en cuisine ». Rien d'autre : remises, codes promo,
 * remarques et encaissement restent à la caisse.
 *
 * Coupure de courant ou d'Internet : le dernier menu et le plan de salle restent sur la tablette,
 * la commande est gardée et part seule au retour de la connexion (offline.ts).
 */

type TableState = 'free' | 'busy' | 'ready' | 'call';

export function TakeOrderPage({ me, feed }: { me: Me; feed?: ActivityFeed }) {
  const location = me.locations[0] ?? null;
  const locationId = location?.id ?? null;
  const currency = (location?.currency ?? 'XAF') as CurrencyCode;
  const [floor, setFloor] = useState<Floor | null>(() => (locationId ? readCache<Floor>(`floor.${locationId}`) : null));
  const [checks, setChecks] = useState<Check[]>([]);
  const [menu, setMenu] = useState<AdminMenu | null>(() => (locationId ? readCache<AdminMenu>(`menu.${locationId}`) : null));
  const [pricing, setPricing] = useState<PricingConfig | null>(() => (locationId ? readCache<PricingConfig>(`pricing.${locationId}`) : null));
  const [tableId, setTableId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // Un ticket par table : passer d'une table à l'autre ne perd rien.
  const [tickets, setTickets] = useState<Record<string, TicketLine[]>>({});
  const [options, setOptions] = useState<PricingProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);
  // Bandeau « plat du jour » : la première annonce diffusée en ce moment sur le menu client (design v3).
  const [announcements, setAnnouncements] = useState<Announcement[]>(() => (locationId ? (readCache<Announcement[]>(`announcements.${locationId}`) ?? []) : []));
  const [details, setDetails] = useState<LocationDetails | null>(() => (locationId ? readCache<LocationDetails>(`location.${locationId}`) : null));
  const [query, setQuery] = useState('');
  const queued = useQueuedOrders().filter((o) => o.locationId === locationId);
  const waiting = queued.filter((o) => !o.error);
  // File vidée au retour du réseau : le message de coupure laisse la place à la confirmation.
  const offlineNotice = !!sent?.startsWith('Pas de connexion');
  useEffect(() => {
    if (offlineNotice && waiting.length === 0 && queued.every((o) => !o.error)) setSent('Connexion revenue : les commandes gardées sont parties en cuisine.');
  }, [offlineNotice, waiting.length]);

  const loadMenu = useCallback(async () => {
    if (!locationId) return;
    try {
      const nextMenu = await api<AdminMenu>('GET', `/locations/${locationId}/menu`);
      setMenu(nextMenu);
      saveCache(`menu.${locationId}`, nextMenu);
      const nextPricing = await api<PricingConfig>('GET', `/locations/${locationId}/pricing`).catch(() => null);
      if (nextPricing) {
        setPricing(nextPricing);
        saveCache(`pricing.${locationId}`, nextPricing);
      }
    } catch (err) {
      // Hors ligne avec un menu déjà gardé : on continue sans rien signaler, la barre du haut le dit.
      if (!(isOffline(err) && readCache(`menu.${locationId}`))) setError(err);
    }
  }, [locationId]);

  const loadChecks = useCallback(async () => {
    if (!locationId) return;
    try {
      setChecks(await api<Check[]>('GET', `/locations/${locationId}/checks`));
    } catch {
      /* la barre du haut signale déjà une coupure */
    }
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;
    api<Floor>('GET', `/locations/${locationId}/floor`).then(
      (next) => {
        setFloor(next);
        saveCache(`floor.${locationId}`, next);
      },
      (err) => {
        if (!(isOffline(err) && readCache(`floor.${locationId}`))) setError(err);
      },
    );
    void loadMenu();
    api<Announcement[]>('GET', `/locations/${locationId}/announcements`).then(
      (list) => {
        setAnnouncements(list);
        saveCache(`announcements.${locationId}`, list);
      },
      () => undefined,
    );
    api<LocationDetails[]>('GET', '/locations').then(
      (list) => {
        const found = list.find((l) => l.id === locationId) ?? null;
        setDetails(found);
        if (found) saveCache(`location.${locationId}`, found);
      },
      () => undefined,
    );
  }, [locationId, loadMenu]);

  // Occupation relue toutes les 5 s : autres serveurs, commandes QR, caisse.
  useEffect(() => {
    void loadChecks();
    const id = setInterval(() => {
      if (!document.hidden) void loadChecks();
    }, 5000);
    return () => clearInterval(id);
  }, [loadChecks]);

  const zones = useMemo(() => {
    if (!floor) return [];
    return floor.zones
      .map((z) => ({ zone: z, tables: floor.tables.filter((t) => t.zoneId === z.id).sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true })) }))
      .filter((g) => g.tables.length > 0);
  }, [floor]);

  function stateOf(table: DiningTable): { state: TableState; label: string } {
    const atTable = feed?.orders.filter((o) => o.tableId === table.id) ?? [];
    const requests = feed?.requests.filter((r) => r.tableId === table.id) ?? [];
    if (requests.some((r) => r.kind === 'BILL')) return { state: 'call', label: 'Addition' };
    if (requests.length > 0) return { state: 'call', label: 'Appel' };
    if (atTable.some((o) => o.status === 'PENDING')) return { state: 'call', label: 'Commande QR' };
    if (atTable.some((o) => o.status === 'READY')) return { state: 'ready', label: 'Plat prêt' };
    if (waiting.some((o) => o.tableId === table.id)) return { state: 'busy', label: 'À envoyer' };
    if (atTable.length > 0 || checks.some((c) => c.kind === 'session' && c.tableId === table.id)) return { state: 'busy', label: 'Occupée' };
    return { state: 'free', label: 'Libre' };
  }

  const table = floor?.tables.find((t) => t.id === tableId) ?? null;
  const lines = tableId ? (tickets[tableId] ?? []) : [];
  const setLines = (update: (current: TicketLine[]) => TicketLine[]) => {
    if (!tableId) return;
    setTickets((all) => ({ ...all, [tableId]: update(all[tableId] ?? []) }));
  };

  const categories = useMemo(() => (menu ? [...menu.categories].sort((a, b) => a.sort - b.sort) : []), [menu]);
  const activeCategory = categoryId ?? categories[0]?.id ?? null;
  const search = query.trim().toLocaleLowerCase('fr');
  const products = useMemo(
    () => (menu ? menu.products.filter((p) => (search ? p.name.toLocaleLowerCase('fr').includes(search) : p.categoryId === activeCategory)).sort((a, b) => a.sort - b.sort) : []),
    [menu, activeCategory, search],
  );
  // Plat sans photo : photo d'exemple du catalogue (une vraie photo n'est jamais remplacée).
  const samplePhoto = useDishPhoto();
  const photoOf = (p: Product) => (p.photoUrl ? mediaSrc(p.photoUrl) : samplePhoto(p.name));
  // Une catégorie avec des photos garde des tuiles de même hauteur : emplacement vide pour les plats sans photo.
  const withPhotos = products.some((p) => photoOf(p));
  const inTicket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.productId, (counts.get(l.productId) ?? 0) + l.quantity);
    return counts;
  }, [lines]);

  // Photo d'une catégorie : celle de son premier plat en photo.
  const categoryPhoto = (categoryId: string) => {
    for (const p of menu?.products ?? []) {
      if (p.categoryId !== categoryId) continue;
      const photo = photoOf(p);
      if (photo) return photo;
    }
    return null;
  };
  const firstPhoto = menu?.products.map(photoOf).find((x) => x) ?? null;
  const productById = (id: string | null) => (id ? (menu?.products.find((p) => p.id === id) ?? null) : null);
  const hero = announcements.find((a) => a.live) ?? null;
  const heroProduct = hero?.targetKind === 'PRODUCT' ? productById(hero.targetId) : null;
  const heroPhoto = hero
    ? hero.photoUrl
      ? mediaSrc(hero.photoUrl)
      : heroProduct
        ? photoOf(heroProduct)
        : hero.targetKind === 'CATEGORY' && hero.targetId
          ? categoryPhoto(hero.targetId)
          : firstPhoto
    : null;
  const zoneOf = (t: DiningTable | null) => (t ? (floor?.zones.find((z) => z.id === t.zoneId) ?? null) : null);
  const occupied = floor ? floor.tables.filter((t) => stateOf(t).state !== 'free').length : 0;

  // Même calcul que la caisse et le serveur : promotions automatiques et taxes comprises.
  const quote = menu && pricing && lines.length > 0 ? ticketPricing(menu, pricing, lines, null, Date.now()) : null;
  const total = quote ? quote.total : lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const money = (v: number) => formatMoney(v, currency);

  function add(line: Omit<TicketLine, 'key'>) {
    setSent(null);
    setError(null);
    setLines((current) => {
      const same = current.find((l) => l.productId === line.productId && l.variantId === line.variantId && l.note === line.note && [...l.modifierIds].sort().join() === [...line.modifierIds].sort().join());
      return same ? current.map((l) => (l === same ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l)) : [...current, { ...line, key: nextKey() }];
    });
  }

  function tap(p: Product) {
    if (!menu || !p.isAvailable || !tableId) return;
    const priced = toPricing(menu, p);
    if (priced.variants.length === 0 && priced.modifierGroups.length === 0) {
      add({ productId: p.id, name: p.name, variantId: null, modifierIds: [], detail: '', unitPrice: p.promoPrice ?? p.price, quantity: 1, note: null });
    } else {
      setOptions(priced);
    }
  }

  /** Bouton du bandeau : un plat s'ajoute à la commande (ou se montre si aucune table n'est choisie), une catégorie s'ouvre. */
  function heroAction() {
    if (!hero) return;
    setQuery('');
    if (hero.targetKind === 'CATEGORY' && hero.targetId) {
      setCategoryId(hero.targetId);
      return;
    }
    if (heroProduct) {
      setCategoryId(heroProduct.categoryId);
      if (tableId && heroProduct.isAvailable) tap(heroProduct);
      else window.setTimeout(() => document.getElementById(`take-p-${heroProduct.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    }
  }

  const changeQty = (key: string, delta: number) => setLines((current) => current.map((l) => (l.key === key ? { ...l, quantity: Math.min(99, l.quantity + delta) } : l)).filter((l) => l.quantity > 0));

  async function send() {
    if (!locationId || !table || lines.length === 0) return;
    setBusy(true);
    setError(null);
    // Identifiant créé ici : renvoyée après une coupure, la commande n'est enregistrée qu'une fois.
    const id = uuidv7();
    const body = {
      serviceType: 'DINE_IN',
      tableId: table.id,
      customerName: null,
      note: null,
      lines: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, modifierIds: l.modifierIds, quantity: l.quantity, note: l.note })),
      promoCode: null,
    };
    try {
      const order = await api<Order>('POST', `/locations/${locationId}/orders`, { ...body, id });
      feed?.applyOrder(order);
      setTickets((all) => ({ ...all, [table.id]: [] }));
      setSent(`Commande n°${order.number} envoyée en cuisine`);
      void loadChecks();
      // Les plats épuisés entre-temps sont relus pour la commande suivante.
      void loadMenu();
    } catch (err) {
      if (isOffline(err)) {
        queueOrder({ id, locationId, tableId: table.id, tableLabel: table.label, body });
        setTickets((all) => ({ ...all, [table.id]: [] }));
        setSent(`Pas de connexion : la commande de la table ${table.label} est gardée sur la tablette. Elle partira seule au retour de la connexion.`);
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!locationId) return <p className="take-none">Aucun établissement.</p>;

  const zone = zoneOf(table);
  const linePhoto = (l: TicketLine) => {
    const p = menu?.products.find((x) => x.id === l.productId) ?? null;
    return p ? photoOf(p) : samplePhoto(l.name);
  };
  const occupiedText = occupied > 0 ? `${occupied} table${occupied > 1 ? 's' : ''} occupée${occupied > 1 ? 's' : ''}` : null;

  return (
    <section className="take">
      <div className="take-main">
        <ServiceHeader userName={me.user.displayName} restaurantName={location?.name ?? 'AfriKaisse'} logo={details?.logoUrl ? mediaSrc(details.logoUrl) : firstPhoto} detail={occupiedText}>
          <label className="take-search">
            <Icon name="search" />
            <input type="search" placeholder="Rechercher un plat…" aria-label="Rechercher un plat" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </ServiceHeader>

        <div className="take-tables" aria-label="Tables">
          {floor && zones.length === 0 && <p className="take-none">Aucune table. Ajoutez-les dans Plus → Tables.</p>}
          {zones.map(({ zone: z, tables }) => (
            <div key={z.id} className="take-zone-block">
              {zones.length > 1 && (
                <h3 className="take-zone">
                  <i className="zone-dot" style={zoneVars(z)} aria-hidden="true" />
                  {z.name}
                </h3>
              )}
              <div className="take-table-grid">
                {tables.map((t) => {
                  const st = stateOf(t);
                  return (
                    <button
                      key={t.id}
                      className={`take-table zone-stripe ${st.state}`}
                      style={zoneVars(z)}
                      aria-pressed={t.id === tableId}
                      onClick={() => {
                        setTableId(t.id);
                        setSent(null);
                        setError(null);
                      }}
                    >
                      <b>{t.label}</b>
                      <span>{st.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="take-scroll take-body">
          {hero && (
            <div className="take-hero">
              {heroPhoto && <img src={heroPhoto} alt="" />}
              <div className="take-hero-veil" />
              <div className="take-hero-text">
                <small>{hero.targetKind === 'PRODUCT' ? 'Plat du jour' : 'À la une'}</small>
                <strong>{hero.title}</strong>
                {hero.body && <span>{hero.body}</span>}
                {(hero.targetKind || hero.buttonLabel) && (
                  <button type="button" onClick={heroAction}>
                    {hero.buttonLabel ?? (hero.targetKind === 'PRODUCT' ? 'Ajouter à la commande' : 'Voir')}
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="take-section">
            <h2>{search ? `Résultats pour « ${query.trim()} »` : 'Catégories'}</h2>
            {search && (
              <button type="button" className="link" onClick={() => setQuery('')}>
                Effacer
              </button>
            )}
          </div>
          {!search && (
            <nav className="take-cats" aria-label="Catégories">
              {categories.map((c) => {
                const photo = categoryPhoto(c.id);
                return (
                  <button key={c.id} aria-pressed={activeCategory === c.id} onClick={() => setCategoryId(c.id)}>
                    {photo && <img src={photo} alt="" loading="lazy" />}
                    {c.name}
                  </button>
                );
              })}
            </nav>
          )}
          {!menu && <p className="take-none">Chargement du menu…</p>}
          {menu && products.length === 0 && <p className="take-none">{search ? 'Aucun plat ne correspond.' : 'Aucun plat dans cette catégorie.'}</p>}
          <div className="take-products">
            {products.map((p) => {
              const qty = inTicket.get(p.id) ?? 0;
              const photo = photoOf(p);
              return (
                <button key={p.id} id={`take-p-${p.id}`} className={`take-product${p.isAvailable ? '' : ' out'}${qty > 0 ? ' in-ticket' : ''}${photo || withPhotos ? '' : ' no-photo'}`} disabled={!p.isAvailable || !tableId} onClick={() => tap(p)}>
                  {/* Photo et bouton « + » : styles/take-order.css et styles/v3.css. */}
                  {photo ? (
                    <img className="take-product-photo" src={photo} alt="" loading="lazy" />
                  ) : (
                    withPhotos && (
                      <span className="take-product-photo take-product-blank" aria-hidden="true">
                        <Icon name="kitchen" />
                      </span>
                    )
                  )}
                  <span className="take-product-name">{p.name}</span>
                  <span className="take-product-foot">
                    {p.isAvailable ? <span className="take-product-price">{money(p.promoPrice ?? p.price)}</span> : <span className="take-product-out">Épuisé</span>}
                    {p.isAvailable && (
                      <span className="take-product-add" aria-hidden="true">
                        <Icon name="add" />
                      </span>
                    )}
                  </span>
                  {qty > 0 && <span className="take-product-qty">×{qty}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="take-ticket" aria-label="Commande">
        <header className="take-ticket-head">
          <div>
            <h2>{table ? `Table ${table.label}` : 'Aucune table'}</h2>
            <p>{table ? stateOf(table).label : 'Choisissez une table'}</p>
          </div>
          {zone && (
            <span className="take-chip">
              <i className="zone-dot" style={zoneVars(zone)} aria-hidden="true" />
              {zone.name}
            </span>
          )}
        </header>
        <ul className="take-lines take-scroll">
          {lines.length === 0 && <li className="take-none">{table ? 'Touchez un plat pour l’ajouter.' : 'Puis touchez les plats.'}</li>}
          {lines.map((l) => {
            const photo = linePhoto(l);
            return (
              <li key={l.key} className="take-line">
                {photo ? (
                  <img className="take-line-photo" src={photo} alt="" />
                ) : (
                  <span className="take-line-photo take-line-blank" aria-hidden="true">
                    <Icon name="kitchen" />
                  </span>
                )}
                <div className="take-line-text">
                  <strong>{l.name}</strong>
                  {(l.detail || l.note) && (
                    <small>
                      {l.detail}
                      {l.detail && l.note ? ' · ' : ''}
                      {l.note ? `« ${l.note} »` : ''}
                    </small>
                  )}
                  <b>{money(l.unitPrice * l.quantity)}</b>
                </div>
                <div className="take-qty">
                  <button aria-label={`Enlever un ${l.name}`} onClick={() => changeQty(l.key, -1)}>
                    <Icon name="minus" />
                  </button>
                  <b>{l.quantity}</b>
                  <button aria-label={`Ajouter un ${l.name}`} onClick={() => changeQty(l.key, 1)}>
                    <Icon name="add" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="take-foot">
          <ErrorMessage error={error} />
          {sent && (
            <p className="take-sent" role="status">
              <Icon name="ok" />
              {sent}
            </p>
          )}
          {waiting.length > 0 && (
            <p className="take-queue" role="status">
              <Icon name="sync" />
              {waiting.length} commande{waiting.length > 1 ? 's' : ''} en attente d'envoi
            </p>
          )}
          {queued
            .filter((o) => o.error)
            .map((o) => (
              <div key={o.id} className="take-queue-error" role="alert">
                <span>
                  Table {o.tableLabel} non envoyée : {o.error}
                </span>
                <button onClick={() => dropQueuedOrder(o.id)}>Retirer</button>
              </div>
            ))}
          {quote && quote.promotionDiscount > 0 && (
            <>
              <div className="take-sub">
                <span>Sous-total</span>
                <span>{money(quote.subtotal)}</span>
              </div>
              <div className="take-sub take-sub-promo">
                <span>Promotion</span>
                <span>− {money(quote.promotionDiscount)}</span>
              </div>
            </>
          )}
          <div className="take-total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <button className="take-send" disabled={busy || !table || lines.length === 0} onClick={send}>
            <Icon name="send" />
            {busy ? 'Envoi…' : 'Envoyer en cuisine'}
          </button>
        </footer>
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
    </section>
  );
}
