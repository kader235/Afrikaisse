import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  INVENTORY_UNITS,
  INVENTORY_UNIT_LABELS,
  MOVEMENT_KIND_LABELS,
  formatMoney,
  type AdminMenu,
  type CurrencyCode,
  type InventoryItem,
  type InventoryUnit,
  type Me,
  type Product,
  type Recipe,
  type StockMovement,
} from '@afrikaisse/core';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, Icon, MoneyInput, OkMessage, Window } from '../ui.tsx';

/**
 * Stock : articles et mouvements (réception, sortie, perte, inventaire), recettes des plats.
 * Le niveau n'est jamais saisi à la main : il découle des mouvements et des ventes confirmées.
 */

type Tab = 'items' | 'recipes';
type MoveKind = 'IN' | 'OUT' | 'LOSS' | 'COUNT';
type DialogState = null | { kind: 'item'; item?: InventoryItem } | { kind: 'move'; move: MoveKind; item: InventoryItem };

const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const STATE: Record<InventoryItem['state'], [string, string]> = {
  OK: ['', '—'],
  LOW: ['st st-pending', 'Bas'],
  OUT: ['st st-cancelled', 'Épuisé'],
};
const MOVE_TITLES: Record<MoveKind, string> = { IN: 'Réception', OUT: 'Sortie', LOSS: 'Perte', COUNT: 'Inventaire' };

export function StockPage({ me }: { me: Me }) {
  const locationId = me.locations[0]?.id ?? null;
  const canManage = me.permissions.includes('inventory.manage');
  const [tab, setTab] = useState<Tab>('items');
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currency: CurrencyCode = menu?.location.currency ?? 'XAF';
  const selected = items?.find((i) => i.id === selectedId) ?? null;

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [list, adminMenu] = await Promise.all([api<InventoryItem[]>('GET', `/locations/${locationId}/inventory`), api<AdminMenu>('GET', `/locations/${locationId}/menu`)]);
      setItems(list);
      setMenu(adminMenu);
    } catch (err) {
      setError(err);
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) return setMovements([]);
    api<StockMovement[]>('GET', `/inventory/${selectedId}/movements`).then(setMovements, setError);
  }, [selectedId, items]);

  async function archive(item: InventoryItem) {
    setError(null);
    setNotice(null);
    try {
      await api('POST', `/inventory/${item.id}/archive`);
      setSelectedId(null);
      setNotice(`« ${item.name} » archivé.`);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  const low = (items ?? []).filter((i) => i.state !== 'OK').length;
  const value = (items ?? []).reduce((s, i) => s + i.value, 0);

  return (
    <>
      <Window title="Stock" count={items ? `${items.length} article(s) · valeur ${formatMoney(value, currency)}${low ? ` · ${low} à réapprovisionner` : ''}` : undefined} bodyless>
        <div className="subtabs" role="tablist">
          <button role="tab" aria-current={tab === 'items' ? 'page' : undefined} onClick={() => setTab('items')}>
            Articles
            {low > 0 && <span className="count-pill">{low}</span>}
          </button>
          <button role="tab" aria-current={tab === 'recipes' ? 'page' : undefined} onClick={() => setTab('recipes')}>
            Recettes
          </button>
        </div>
        {(!!error || notice) && (
          <div className="window-body" style={{ paddingBottom: 0 }}>
            <ErrorMessage error={error} />
            {notice && !error && <OkMessage>{notice}</OkMessage>}
          </div>
        )}

        {tab === 'items' && (
          <>
            {canManage && (
              <div className="toolbar">
                <button className="btn" onClick={() => setDialog({ kind: 'item' })}>
                  <Icon name="add" />
                  Nouvel article
                </button>
                <button className="btn" disabled={!selected} onClick={() => selected && setDialog({ kind: 'item', item: selected })}>
                  <Icon name="edit" />
                  Modifier
                </button>
                <span className="sep" />
                {(['IN', 'COUNT', 'LOSS', 'OUT'] as MoveKind[]).map((move) => (
                  <button key={move} className={move === 'IN' ? 'btn btn-primary' : 'btn'} disabled={!selected} onClick={() => selected && setDialog({ kind: 'move', move, item: selected })}>
                    {MOVE_TITLES[move]}
                  </button>
                ))}
                <span className="sep" />
                <button className="btn" disabled={!selected} onClick={() => selected && archive(selected)}>
                  <Icon name="archive" />
                  Archiver
                </button>
                <button className="btn" onClick={() => void load()}>
                  <Icon name="refresh" />
                  Actualiser
                </button>
              </div>
            )}
            <div className="floor">
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th>En stock</th>
                      <th>Seuil</th>
                      <th>Valeur</th>
                      <th>État</th>
                      <th>Recettes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items?.length === 0 && (
                      <tr>
                        <td className="empty" colSpan={6}>
                          Aucun article. Créez vos ingrédients et boissons (poulet, riz, huile, bouteilles…), puis faites une réception.
                        </td>
                      </tr>
                    )}
                    {items?.map((i) => (
                      <tr key={i.id} className="selectable" aria-selected={i.id === selectedId} onClick={() => setSelectedId(i.id)}>
                        <td>
                          <strong>{i.name}</strong>
                        </td>
                        <td className="num">
                          {qty(i.level)} {INVENTORY_UNIT_LABELS[i.unit]}
                        </td>
                        <td className="num">{i.minLevel > 0 ? `${qty(i.minLevel)} ${INVENTORY_UNIT_LABELS[i.unit]}` : '—'}</td>
                        <td className="num">{i.unitCost !== null ? formatMoney(i.value, currency) : '—'}</td>
                        <td>{STATE[i.state][0] ? <span className={STATE[i.state][0]}>{STATE[i.state][1]}</span> : STATE[i.state][1]}</td>
                        <td className="num">{i.usedBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <aside className="floor-side">
                {selected ? (
                  <fieldset className="group">
                    <legend>{selected.name}</legend>
                    <dl className="kv">
                      <dt>En stock</dt>
                      <dd>
                        <strong>
                          {qty(selected.level)} {INVENTORY_UNIT_LABELS[selected.unit]}
                        </strong>
                      </dd>
                      <dt>Coût unitaire</dt>
                      <dd>{selected.unitCost !== null ? formatMoney(selected.unitCost, currency) : '—'}</dd>
                    </dl>
                    <table className="grid compact">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Mouvement</th>
                          <th>Qté</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.length === 0 && (
                          <tr>
                            <td className="empty" colSpan={3}>
                              Aucun mouvement.
                            </td>
                          </tr>
                        )}
                        {movements.map((m) => (
                          <tr key={m.id} title={[m.by, m.reason].filter(Boolean).join(' · ')}>
                            <td>{new Date(m.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                            <td>
                              {MOVEMENT_KIND_LABELS[m.kind]}
                              {m.orderNumber !== null && ` n°${m.orderNumber}`}
                              {m.reason && <div className="muted">{m.reason}</div>}
                            </td>
                            <td className="num">{`${m.quantity > 0 ? '+' : ''}${qty(m.quantity)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </fieldset>
                ) : (
                  <p className="muted">
                    Touchez un article pour voir ses mouvements. Les ventes confirmées déduisent les recettes toutes seules ; un plat dont un ingrédient manque passe « épuisé » et revient à la
                    réception suivante.
                  </p>
                )}
              </aside>
            </div>
          </>
        )}

        {tab === 'recipes' && menu && items && <RecipesTab menu={menu} items={items} canManage={canManage} currency={currency} onSaved={(name) => { setNotice(`Recette de « ${name} » enregistrée.`); void load(); }} />}
      </Window>

      {dialog?.kind === 'item' && locationId && (
        <ItemDialog
          locationId={locationId}
          item={dialog.item}
          currency={currency}
          onClose={() => setDialog(null)}
          onDone={(saved) => {
            setDialog(null);
            setSelectedId(saved.id);
            setNotice(`« ${saved.name} » enregistré.`);
            void load();
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveDialog
          item={dialog.item}
          move={dialog.move}
          currency={currency}
          onClose={() => setDialog(null)}
          onDone={(saved) => {
            setDialog(null);
            setNotice(`${MOVE_TITLES[dialog.move]} enregistrée : ${saved.name} ${qty(saved.level)} ${INVENTORY_UNIT_LABELS[saved.unit]}.`);
            void load();
          }}
        />
      )}
    </>
  );
}

function ItemDialog({ locationId, item, currency, onDone, onClose }: { locationId: string; item?: InventoryItem; currency: CurrencyCode; onDone: (i: InventoryItem) => void; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<InventoryUnit>(item?.unit ?? 'PIECE');
  const [minLevel, setMinLevel] = useState(item ? String(item.minLevel) : '0');
  const [unitCost, setUnitCost] = useState<number | null>(item?.unitCost ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), unit, minLevel: Number(minLevel.replace(',', '.')) || 0, unitCost };
      onDone(item ? await api<InventoryItem>('PATCH', `/inventory/${item.id}`, body) : await api<InventoryItem>('POST', `/locations/${locationId}/inventory`, body));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={item ? `Modifier — ${item.name}` : 'Nouvel article de stock'}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !name.trim()}>
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
            <label htmlFor="inv-name">Nom</label>
            <input id="inv-name" required maxLength={60} autoFocus placeholder="Poulet, riz, huile, bière 65 cl…" value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="inv-unit">Unité</label>
            <select id="inv-unit" value={unit} onChange={(e) => setUnit(e.target.value as InventoryUnit)}>
              {INVENTORY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {INVENTORY_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
            <label htmlFor="inv-min">Seuil d'alerte</label>
            <input id="inv-min" inputMode="decimal" value={minLevel} onChange={(e) => setMinLevel(e.target.value)} />
            <label htmlFor="inv-cost">Coût par {INVENTORY_UNIT_LABELS[unit]}</label>
            <MoneyInput id="inv-cost" value={unitCost} currency={currency} allowEmpty onChange={setUnitCost} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

function MoveDialog({ item, move, currency, onDone, onClose }: { item: InventoryItem; move: MoveKind; currency: CurrencyCode; onDone: (i: InventoryItem) => void; onClose: () => void }) {
  const [quantity, setQuantity] = useState(move === 'COUNT' ? String(item.level) : '');
  const [unitCost, setUnitCost] = useState<number | null>(item.unitCost);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const value = Number(quantity.replace(',', '.'));
  const needsReason = move === 'LOSS' || move === 'OUT';
  const unit = INVENTORY_UNIT_LABELS[item.unit];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api<InventoryItem>('POST', `/inventory/${item.id}/movements`, { kind: move, quantity: value, ...(move === 'IN' && { unitCost }), reason: reason.trim() }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={`${MOVE_TITLES[move]} — ${item.name}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !Number.isFinite(value) || value < 0 || (move !== 'COUNT' && value <= 0) || (needsReason && !reason.trim())}>
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
          <p className="muted" style={{ marginBottom: 10 }}>
            En stock : {qty(item.level)} {unit}
          </p>
          <div className="form">
            <label htmlFor="mv-qty">{move === 'COUNT' ? 'Quantité comptée' : 'Quantité'}</label>
            <input id="mv-qty" required inputMode="decimal" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            {move === 'COUNT' && Number.isFinite(value) && (
              <>
                <label>Écart</label>
                <strong>
                  {value - item.level > 0 ? '+' : ''}
                  {qty(value - item.level)} {unit}
                </strong>
              </>
            )}
            {move === 'IN' && (
              <>
                <label htmlFor="mv-cost">Coût par {unit}</label>
                <MoneyInput id="mv-cost" value={unitCost} currency={currency} allowEmpty onChange={setUnitCost} />
              </>
            )}
            <label htmlFor="mv-reason">{needsReason ? 'Motif' : 'Remarque'}</label>
            <input id="mv-reason" required={needsReason} maxLength={200} placeholder={move === 'LOSS' ? 'Périmé, cassé…' : move === 'IN' ? 'Fournisseur, n° de bon…' : ''} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

type Row = { key: number; itemId: string; variantId: string | null; quantity: string };
let rowKey = 0;

function RecipesTab({ menu, items, canManage, currency, onSaved }: { menu: AdminMenu; items: InventoryItem[]; canManage: boolean; currency: CurrencyCode; onSaved: (name: string) => void }) {
  const [productId, setProductId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const product: Product | null = menu.products.find((p) => p.id === productId) ?? null;

  useEffect(() => {
    if (!productId) return setRows([]);
    setError(null);
    api<Recipe>('GET', `/products/${productId}/recipe`).then(
      (recipe) => setRows(recipe.items.map((i) => ({ key: ++rowKey, itemId: i.itemId, variantId: i.variantId, quantity: String(i.quantity) }))),
      setError,
    );
  }, [productId]);

  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const valid = rows.every((r) => r.itemId && Number(r.quantity.replace(',', '.')) > 0);
  // Coût matière d'une portion « toutes versions » : ce que coûte le plat avant la marge.
  const cost = rows
    .filter((r) => r.variantId === null)
    .reduce((s, r) => {
      const item = items.find((i) => i.id === r.itemId);
      return s + (item?.unitCost ? Number(r.quantity.replace(',', '.')) * item.unitCost : 0);
    }, 0);

  async function save() {
    if (!product) return;
    setBusy(true);
    setError(null);
    try {
      await api('PUT', `/products/${product.id}/recipe`, { items: rows.map((r) => ({ itemId: r.itemId, variantId: r.variantId, quantity: Number(r.quantity.replace(',', '.')) })) });
      onSaved(product.name);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const categories = [...menu.categories].sort((a, b) => a.sort - b.sort);

  return (
    <div className="floor">
      <div className="window-body recipe-products">
        {categories.map((c) => {
          const products = menu.products.filter((p) => p.categoryId === c.id);
          if (products.length === 0) return null;
          return (
            <div key={c.id}>
              <h3 className="recipe-cat">{c.name}</h3>
              <div className="chips">
                {products.map((p) => (
                  <button key={p.id} className="chip" aria-pressed={p.id === productId} onClick={() => setProductId(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <aside className="floor-side">
        {!product ? (
          <p className="muted">Choisissez un plat ou une boisson pour décrire ce qu'il consomme : les ventes déduiront ces quantités du stock.</p>
        ) : (
          <fieldset className="group">
            <legend>Recette — {product.name}</legend>
            <ErrorMessage error={error} />
            {items.length === 0 && <p className="muted">Créez d'abord des articles dans l'onglet Articles.</p>}
            {rows.map((r) => {
              const item = items.find((i) => i.id === r.itemId);
              return (
                <div className="recipe-row" key={r.key}>
                  <select aria-label="Article" value={r.itemId} disabled={!canManage} onChange={(e) => update(r.key, { itemId: e.target.value })}>
                    <option value="">Article…</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                  {product.variants.length > 0 && (
                    <select aria-label="Version" value={r.variantId ?? ''} disabled={!canManage} onChange={(e) => update(r.key, { variantId: e.target.value || null })}>
                      <option value="">Toutes versions</option>
                      {product.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="recipe-qty">
                    <input aria-label="Quantité" inputMode="decimal" value={r.quantity} disabled={!canManage} onChange={(e) => update(r.key, { quantity: e.target.value })} />
                    {item ? INVENTORY_UNIT_LABELS[item.unit] : ''}
                  </span>
                  {canManage && (
                    <button className="btn" aria-label="Retirer" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            {canManage && (
              <div className="order-actions" style={{ marginTop: 10 }}>
                <button className="btn" disabled={items.length === 0} onClick={() => setRows((list) => [...list, { key: ++rowKey, itemId: '', variantId: null, quantity: '' }])}>
                  <Icon name="add" />
                  Ajouter un ingrédient
                </button>
                <button className="btn btn-primary" disabled={busy || !valid} onClick={save}>
                  Enregistrer la recette
                </button>
              </div>
            )}
            {cost > 0 && (
              <p className="muted" style={{ marginTop: 8 }}>
                Coût matière estimé : <strong>{formatMoney(Math.round(cost), currency)}</strong> pour un prix de {formatMoney(product.promoPrice ?? product.price, currency)} (
                {Math.round((cost * 100) / (product.promoPrice ?? product.price))} %).
              </p>
            )}
          </fieldset>
        )}
      </aside>
    </div>
  );
}
