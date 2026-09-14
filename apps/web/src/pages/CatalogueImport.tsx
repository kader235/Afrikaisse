import { useEffect, useMemo, useState } from 'react';
import { CATALOGUE_CATEGORIES, catalogueSchema, cataloguePrice, dishesForCountry, formatMoney, type AdminMenu, type Catalogue, type Media } from '@afrikaisse/core';
import { ApiError, UserFacingError, api } from '../api.ts';
import { compressImage } from '../images.ts';
import { COUNTRIES } from '../labels.ts';
import { ErrorMessage } from '../ui.tsx';

/** Données embarquées avec les écrans : servies par le Cloud, le serveur local et l'application tablette. */
const CATALOGUE_URL = '/catalogue/catalogue.json';
const imageUrl = (file: string) => `/catalogue/images/${file}`;
const RECOMMENDED = 'recommandes';

/** Panne passagère du serveur (application qui redémarre chez l'hébergeur) : on retente une fois. */
async function retryOnce<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof ApiError) || (err.status !== 0 && err.status < 500)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return call();
  }
}

/**
 * Importer des plats pré-remplis : pays, famille de plats, cartes à cocher (nom, prix, courte description,
 * photo, disponible ou non), puis un import par les mêmes routes que la saisie à la main.
 */
export function CatalogueImport({ menu, country, onClose, onDone }: { menu: AdminMenu; country: string; onClose: () => void; onDone: (imported: number, failed: string[]) => void }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pays, setPays] = useState(country);
  const [group, setGroup] = useState(RECOMMENDED);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  // Plats à importer « non disponibles » (le restaurateur ne les sert pas encore).
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const currency = menu.location.currency;

  useEffect(() => {
    fetch(CATALOGUE_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (json) => setCatalogue(catalogueSchema.parse(json)),
        () => setError(new UserFacingError('Le catalogue de plats est introuvable sur cet appareil.')),
      );
  }, []);

  useEffect(() => {
    if (progress) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, progress]);

  const existing = useMemo(() => new Set(menu.products.map((p) => p.name.trim().toLowerCase())), [menu.products]);
  const isPresent = (name: string) => existing.has(name.trim().toLowerCase());
  const recommended = catalogue ? dishesForCountry(catalogue, pays) : [];
  const shown = !catalogue ? [] : group === RECOMMENDED ? recommended : catalogue.dishes.filter((d) => d.group === group);
  const selectable = shown.filter((d) => !isPresent(d.name));
  const allChosen = selectable.length > 0 && selectable.every((d) => chosen.has(d.id));
  const countryName = COUNTRIES.find((c) => c.code === pays)?.name ?? pays;

  const flip = (set: (update: (prev: Set<string>) => Set<string>) => void, id: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const d of selectable) {
        if (allChosen) next.delete(d.id);
        else next.add(d.id);
      }
      return next;
    });

  async function importDishes() {
    if (!catalogue) return;
    // Dans l'ordre des catégories d'une carte : entrées, plats, grillades…
    const rank = (c: string) => CATALOGUE_CATEGORIES.indexOf(c as (typeof CATALOGUE_CATEGORIES)[number]);
    const dishes = catalogue.dishes.filter((d) => chosen.has(d.id) && !isPresent(d.name)).sort((a, b) => rank(a.category) - rank(b.category));
    setError(null);
    setProgress({ done: 0, total: dishes.length });
    let current = menu;
    let imported = 0;
    const failed: string[] = [];

    const categoryId = async (name: string) => {
      const same = (c: { name: string }) => c.name.trim().toLowerCase() === name.toLowerCase();
      const found = current.categories.find(same);
      if (found) return found.id;
      current = await retryOnce(() => api<AdminMenu>('POST', `/locations/${menu.location.id}/categories`, { name }));
      return current.categories.find(same)!.id;
    };

    for (const [index, dish] of dishes.entries()) {
      try {
        const catId = await categoryId(dish.category);
        let photoMediaId: string | null = null;
        if (dish.image) {
          try {
            const blob = await (await fetch(imageUrl(dish.image))).blob();
            const image = await compressImage(new File([blob], dish.image, { type: blob.type || 'image/webp' }), 1024, 0.8);
            photoMediaId = (await retryOnce(() => api<Media>('POST', `/locations/${menu.location.id}/media`, { contentType: image.contentType, dataBase64: image.dataBase64 }))).id;
          } catch {
            photoMediaId = null; // un plat sans photo vaut mieux qu'un plat absent
          }
        }
        current = await retryOnce(() => api<AdminMenu>('POST', `/categories/${catId}/products`, {
          name: dish.name,
          description: dish.description,
          price: cataloguePrice(dish.priceXaf, currency),
          photoMediaId,
          isAvailable: !unavailable.has(dish.id),
        }));
        imported += 1;
      } catch {
        failed.push(dish.name);
      }
      setProgress({ done: index + 1, total: dishes.length });
    }
    setProgress(null);
    onDone(imported, failed);
  }

  return (
    <div className="overlay" role="presentation">
      <div className="dialog dialog-xl" role="dialog" aria-modal="true" aria-label="Importer des plats">
        <div className="dialog-title">
          <span>Importer des plats</span>
          {!progress && (
            <button type="button" aria-label="Fermer" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        <div className="dialog-body catalogue">
          <ErrorMessage error={error} />
          <div className="catalogue-head">
            <label>
              Pays
              <select
                value={pays}
                disabled={!!progress}
                onChange={(e) => {
                  setPays(e.target.value);
                  setGroup(RECOMMENDED);
                }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">Touchez les plats que vous vendez. Les prix sont indicatifs en {currency} : vous les ajusterez ensuite. Les plats déjà dans votre menu sont grisés.</p>
          </div>

          {catalogue && (
            <div className="chips-row" role="tablist">
              <button type="button" role="tab" className="chip-tab" aria-current={group === RECOMMENDED ? 'true' : undefined} onClick={() => setGroup(RECOMMENDED)}>
                Vendus au {countryName}
                <span className="count-pill">{recommended.length}</span>
              </button>
              {catalogue.groups.map((g) => {
                const n = catalogue.dishes.filter((d) => d.group === g.id).length;
                if (n === 0) return null;
                return (
                  <button key={g.id} type="button" role="tab" className="chip-tab" aria-current={group === g.id ? 'true' : undefined} onClick={() => setGroup(g.id)}>
                    {g.label}
                    <span className="count-pill">{n}</span>
                  </button>
                );
              })}
            </div>
          )}

          {catalogue && (
            <div className="catalogue-bar">
              <button type="button" className="btn" onClick={toggleAll} disabled={selectable.length === 0 || !!progress}>
                {allChosen ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
            </div>
          )}

          {!catalogue && !error && <p className="muted">Chargement du catalogue…</p>}
          {catalogue && shown.length === 0 && <p className="muted">Aucun plat dans cette famille pour le moment.</p>}

          <div className="dish-grid">
            {shown.map((d) => {
              const present = isPresent(d.name);
              const on = chosen.has(d.id);
              const available = !unavailable.has(d.id);
              return (
                <div key={d.id} className={`dish-card${on ? ' on' : ''}${present ? ' present' : ''}`}>
                  <button type="button" className="dish-select" aria-pressed={on} disabled={present || !!progress} onClick={() => flip(setChosen, d.id)}>
                    {d.image ? (
                      <img className="dish-photo" src={imageUrl(d.image)} alt="" loading="lazy" />
                    ) : (
                      <span className="dish-photo dish-initial" aria-hidden="true">
                        {d.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="dish-check" aria-hidden="true" />
                    <span className="dish-body">
                      <strong>{d.name}</strong>
                      <span className="dish-price">{formatMoney(cataloguePrice(d.priceXaf, currency), currency)}</span>
                      {d.description && <span className="dish-desc">{d.description}</span>}
                    </span>
                  </button>
                  {present ? (
                    <span className="dish-avail dish-present">Déjà dans votre menu</span>
                  ) : (
                    <label className="dish-avail">
                      <input type="checkbox" checked={available} disabled={!!progress} onChange={() => flip(setUnavailable, d.id)} />
                      {available ? 'Disponible' : 'Non disponible'}
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="dialog-foot">
          {progress ? (
            <div className="catalogue-foot">
              <span className="catalogue-count">
                Import en cours : {progress.done} / {progress.total}
              </span>
              <span className="meter catalogue-meter" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <span style={{ inlineSize: `${Math.round((progress.done * 100) / Math.max(1, progress.total))}%` }} />
              </span>
            </div>
          ) : (
            <div className="catalogue-foot">
              <span className="catalogue-count">{chosen.size === 0 ? 'Aucun plat sélectionné' : `${chosen.size} plat${chosen.size > 1 ? 's' : ''} sélectionné${chosen.size > 1 ? 's' : ''}`}</span>
              <button type="button" className="btn" onClick={onClose}>
                Annuler
              </button>
              <button type="button" className="btn btn-primary" disabled={chosen.size === 0 || !catalogue} onClick={importDishes}>
                Importer {chosen.size > 0 ? `${chosen.size} plat${chosen.size > 1 ? 's' : ''}` : 'les plats'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
