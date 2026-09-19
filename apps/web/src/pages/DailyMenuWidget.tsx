import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AdminMenu, DailyMenuState, Product } from '@afrikaisse/core';
import { api } from '../api.ts';
import { readCache, saveCache } from '../offline.ts';
import { ErrorMessage, Icon } from '../ui.tsx';
import '../styles/daily-menu.css';

/**
 * Widget « Menu du jour » du tableau de bord (en hauteur).
 * - Le gérant fixe le menu d'un jour ou d'une période, le réajuste à tout moment (mêmes dates = même menu) ou le retire.
 * - Il marque un plat épuisé / disponible (geste existant, `POST /products/:id/availability`).
 * - Le menu du jour EST celui du menu client (QR) : le client ne voit et ne commande que ces plats ; le serveur refuse le reste.
 * - Sans menu du jour en vigueur, toute la carte est proposée. La caisse n'est jamais limitée par le menu du jour.
 */

const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

interface Draft {
  start: string;
  end: string;
  ids: Set<string>;
}

export function DailyMenuWidget({ locationId, canManage, canAvailability }: { locationId: string; canManage: boolean; canAvailability: boolean }) {
  const cacheKey = `daily-menu.${locationId}`;
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [state, setState] = useState<DailyMenuState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([api<AdminMenu>('GET', `/locations/${locationId}/menu`), api<DailyMenuState>('GET', `/locations/${locationId}/daily-menu`)]);
      setMenu(m);
      setState(s);
      setError(null);
      saveCache(cacheKey, { m, s });
    } catch (err) {
      setError(err);
    }
  }, [locationId, cacheKey]);

  useEffect(() => {
    // Dernier état connu tout de suite (tablette hors ligne), puis lecture fraîche, relue chaque minute.
    const cached = readCache<{ m: AdminMenu; s: DailyMenuState }>(cacheKey);
    setMenu(cached?.m ?? null);
    setState(cached?.s ?? null);
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [cacheKey, load]);

  const current = state?.current ?? null;
  const dishes = useMemo(() => {
    if (!menu || !current) return [];
    const rank = new Map(menu.categories.map((c) => [c.id, c.sort]));
    return menu.products
      .filter((p) => current.productIds.includes(p.id))
      .sort((a, b) => (rank.get(a.categoryId) ?? 0) - (rank.get(b.categoryId) ?? 0) || a.sort - b.sort);
  }, [menu, current]);
  const others = state?.menus.filter((m) => m.id !== current?.id) ?? [];
  // Nuage de la carte : bleu = menu en place, jaune = aucun menu (toute la carte proposée), rouge = au moins un plat épuisé.
  const tone = !current ? 'jaune' : dishes.some((p) => !p.isAvailable) ? 'rouge' : 'bleu';
  const wrap = (color: 'bleu' | 'jaune' | 'rouge', body: ReactNode) => (
    <section className={`card dm-card nuage nuage-${color}`}>
      <h3>Menu du jour</h3>
      {body}
    </section>
  );

  async function toggle(p: Product) {
    setBusy(p.id);
    try {
      setMenu(await api<AdminMenu>('POST', `/products/${p.id}/availability`, { isAvailable: !p.isAvailable }));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  function edit() {
    if (!state) return;
    setDraft({ start: current?.startDate ?? state.today, end: current?.endDate ?? state.today, ids: new Set(current?.productIds ?? []) });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      setState(await api<DailyMenuState>('PUT', `/locations/${locationId}/daily-menu`, { startDate: draft.start, endDate: draft.end, productIds: [...draft.ids] }));
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      setState(await api<DailyMenuState>('POST', `/daily-menus/${id}/archive`, {}));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const flip = (id: string) => setDraft((d) => (d ? { ...d, ids: new Set(d.ids.has(id) ? [...d.ids].filter((x) => x !== id) : [...d.ids, id]) } : d));

  if (draft && menu) {
    return wrap(
      'bleu',
      <div className="dm dm-edit">
        <ErrorMessage error={error} />
        <div className="dm-dates">
          <label>
            Du
            <input type="date" value={draft.start} min={state?.today} onChange={(e) => setDraft({ ...draft, start: e.target.value, end: draft.end < e.target.value ? e.target.value : draft.end })} />
          </label>
          <label>
            Au
            <input type="date" value={draft.end} min={draft.start} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </label>
        </div>
        <p className="dm-hint">Touchez les plats proposés aux clients ({draft.ids.size} choisi{draft.ids.size > 1 ? 's' : ''}).</p>
        <div className="dm-actions">
          <button type="button" className="btn" onClick={() => setDraft({ ...draft, ids: new Set(menu.products.map((p) => p.id)) })}>
            Tout cocher
          </button>
          <button type="button" className="btn" onClick={() => setDraft({ ...draft, ids: new Set() })}>
            Tout décocher
          </button>
        </div>
        <div className="dm-picker">
          {menu.categories.map((c) => {
            const items = menu.products.filter((p) => p.categoryId === c.id);
            if (items.length === 0) return null;
            return (
              <fieldset key={c.id} className="dm-cat">
                <legend>{c.name}</legend>
                <div className="dm-chips">
                  {items.map((p) => (
                    <button type="button" key={p.id} className="chip" aria-pressed={draft.ids.has(p.id)} onClick={() => flip(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
        <div className="dm-actions">
          <button type="button" className="btn btn-primary" disabled={saving || draft.ids.size === 0} onClick={() => void save()}>
            <Icon name="save" />
            Enregistrer
          </button>
          <button type="button" className="btn" disabled={saving} onClick={() => setDraft(null)}>
            Annuler
          </button>
        </div>
      </div>,
    );
  }

  if (!state || !menu) return wrap('bleu', error ? <ErrorMessage error={error} /> : <p className="card-empty">Chargement…</p>);

  const single = current && current.startDate === current.endDate;
  return wrap(
    tone,
    <div className="dm">
      <ErrorMessage error={error} />
      {current ? (
        <>
          <div className="dm-head">
            <span className="etq etq-info">{single ? (current.startDate === state.today ? 'Aujourd’hui' : day(current.startDate)) : `Du ${day(current.startDate)} au ${day(current.endDate)}`}</span>
            <span className="etq etq-info">
              {dishes.length} plat{dishes.length > 1 ? 's' : ''}
            </span>
          </div>
          <ul className="dm-list">
            {dishes.map((p) => (
              <li key={p.id} className={p.isAvailable ? 'dm-item' : 'dm-item off'}>
                <strong>{p.name}</strong>
                {!p.isAvailable && <span className="etq etq-danger">Épuisé</span>}
                {canAvailability && (
                  <button type="button" className="btn" disabled={busy === p.id} onClick={() => void toggle(p)}>
                    {p.isAvailable ? 'Marquer épuisé' : 'Remettre disponible'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="card-empty">Aucun menu du jour : toute la carte est proposée aux clients.</p>
      )}
      {canManage && (
        <div className="dm-actions">
          <button type="button" className="btn btn-primary" onClick={edit}>
            <Icon name={current ? 'edit' : 'add'} />
            {current ? 'Ajuster le menu' : 'Définir le menu du jour'}
          </button>
          {current && (
            <button type="button" className="btn" disabled={busy === current.id} onClick={() => void remove(current.id)}>
              Retirer
            </button>
          )}
        </div>
      )}
      {others.length > 0 && (
        <ul className="dm-next" aria-label="Menus à venir">
          {others.map((m) => (
            <li key={m.id}>
              <span className="etq etq-warn">{m.startDate === m.endDate ? day(m.startDate) : `${day(m.startDate)} → ${day(m.endDate)}`}</span>
              <small>
                {m.productIds.length} plat{m.productIds.length > 1 ? 's' : ''}
              </small>
              {canManage && (
                <button type="button" className="btn" disabled={busy === m.id} onClick={() => void remove(m.id)}>
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>,
  );
}
