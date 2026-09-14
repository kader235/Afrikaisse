import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ALLERGENS,
  formatMoney,
  type AdminMenu,
  type Allergen,
  type Category,
  type LocationDetails,
  type Me,
  type Media,
  type ModifierGroup,
  type Permission,
  type Product,
} from '@afrikaisse/core';
import { ALLERGEN_LABELS, choiceRule } from '../allergens.ts';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { compressImage } from '../images.ts';
import { mediaSrc } from '../platform.ts';
import { Dialog, ErrorMessage, Icon, MoneyInput, OkMessage, Window } from '../ui.tsx';
import { QrTab } from './Qr.tsx';
import { CatalogueImport } from './CatalogueImport.tsx';
import { StationsTab } from './Stations.tsx';
import { PrintersTab } from './Printers.tsx';

/**
 * Menu d'un établissement, pour la tablette du gérant et de la cuisine.
 * Chaque action renvoie le menu complet à jour : l'écran n'a qu'une source de vérité.
 */
type Tab = 'products' | 'options' | 'stations' | 'printers' | 'qr';
type Save = (method: string, path: string, body?: unknown, message?: string) => Promise<void>;

export function MenuPage({ me }: { me: Me }) {
  const { t } = useI18n();
  const can = (p: Permission) => me.permissions.includes(p);
  const [locations, setLocations] = useState<LocationDetails[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [tab, setTab] = useState<Tab>('products');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const country = locations?.find((l) => l.id === locationId)?.country ?? 'TD';

  useEffect(() => {
    api<LocationDetails[]>('GET', '/locations').then((list) => {
      setLocations(list);
      setLocationId((current) => current ?? list[0]?.id ?? null);
    }, setError);
  }, []);

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      setMenu(await api<AdminMenu>('GET', `/locations/${id}/menu`));
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    if (locationId) void load(locationId);
  }, [locationId, load]);

  /** Pour les fenêtres de saisie : l'erreur remonte à la fenêtre, qui reste ouverte. */
  const save: Save = async (method, path, body, message = t('common.saved')) => {
    setNotice(null);
    setMenu(await api<AdminMenu>(method, path, body));
    setError(null);
    setNotice(message);
  };
  /** Pour les boutons directs : l'erreur s'affiche dans l'écran. */
  const act: Save = async (method, path, body, message) => {
    try {
      await save(method, path, body, message);
    } catch (err) {
      setError(err);
    }
  };

  const tabs: [Tab, string][] = [
    ['products', t('menu.tabProducts')],
    ['options', t('menu.tabOptions')],
    ['stations', 'Postes'],
    ...(can('devices.manage') ? ([['printers', 'Imprimantes']] as [Tab, string][]) : []),
    ...(can('tables.read') ? ([['qr', t('menu.tabQr')]] as [Tab, string][]) : []),
  ];

  return (
    <Window
      title={menu ? `${t('menu.title')} — ${menu.location.name}` : t('menu.title')}
      count={menu ? `${menu.products.length} ${t('menu.productsCount')}` : undefined}
      bodyless
      toolbar={
        (locations && locations.length > 1) || (menu && can('menu.manage') && menu.products.length > 0) ? (
          <>
            {locations && locations.length > 1 && (
              <select aria-label={t('team.location')} value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value)} style={{ width: 'auto', marginInlineEnd: 8 }}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            {menu && can('menu.manage') && menu.products.length > 0 && (
              <button className="btn btn-primary" onClick={() => setImporting(true)}>
                <Icon name="add" />
                Importer des plats
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {menu && can('menu.manage') && menu.products.length === 0 && (
        <div className="import-hero">
          <div>
            <h2>Votre menu est vide</h2>
            <p className="muted">Importez en un geste les plats courants de votre pays, avec photo et prix indicatif, puis ajustez-les à votre carte.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setImporting(true)}>
            <Icon name="add" />
            Importer des plats
          </button>
        </div>
      )}
      <div className="subtabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {(!!error || notice) && (
        <div className="window-body" style={{ paddingBottom: 0 }}>
          <ErrorMessage error={error} />
          {notice && !error && <OkMessage>{notice}</OkMessage>}
        </div>
      )}
      {locations?.length === 0 && <div className="empty-state">{t('floor.noLocation')}</div>}
      {menu && tab === 'products' && <ProductsTab menu={menu} canManage={can('menu.manage')} canAvailability={can('menu.availability')} save={save} act={act} onRefresh={() => locationId && load(locationId)} />}
      {menu && tab === 'options' && <OptionsTab menu={menu} canManage={can('menu.manage')} canAvailability={can('menu.availability')} save={save} act={act} onRefresh={() => locationId && load(locationId)} />}
      {menu && tab === 'stations' && <StationsTab menu={menu} canManage={can('menu.manage')} onChanged={() => locationId && load(locationId)} />}
      {menu && locationId && tab === 'printers' && <PrintersTab locationId={locationId} stations={menu.stations} />}
      {locationId && tab === 'qr' && <QrTab locationId={locationId} canManage={can('tables.manage')} />}
      {importing && menu && (
        <CatalogueImport
          menu={menu}
          country={country}
          onClose={() => setImporting(false)}
          onDone={(imported, failed) => {
            setImporting(false);
            setTab('products');
            if (locationId) void load(locationId);
            setError(null);
            setNotice(
              `${imported} plat${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}. Les prix sont indicatifs : vérifiez-les dans la liste.${failed.length ? ` Non importés : ${failed.join(', ')}.` : ''}`,
            );
          }}
        />
      )}
    </Window>
  );
}

// --- Produits ---------------------------------------------------------------

type ProductsDialog =
  | null
  | { kind: 'category'; category?: Category }
  | { kind: 'archiveCategory'; category: Category }
  | { kind: 'product'; product?: Product }
  | { kind: 'archiveProduct'; product: Product };

function swap(ids: string[], index: number, dir: -1 | 1): string[] | null {
  const target = index + dir;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  const a = next[index]!;
  next[index] = next[target]!;
  next[target] = a;
  return next;
}

function ProductsTab({ menu, canManage, canAvailability, save, act, onRefresh }: { menu: AdminMenu; canManage: boolean; canAvailability: boolean; save: Save; act: Save; onRefresh: () => void }) {
  const { t } = useI18n();
  const [categoryId, setCategoryId] = useState<string | null>(menu.categories[0]?.id ?? null);
  const [productId, setProductId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ProductsDialog>(null);

  useEffect(() => {
    if (!menu.categories.some((c) => c.id === categoryId)) setCategoryId(menu.categories[0]?.id ?? null);
  }, [menu, categoryId]);

  const currency = menu.location.currency;
  const category = menu.categories.find((c) => c.id === categoryId) ?? null;
  const products = menu.products.filter((p) => p.categoryId === categoryId);
  const product = products.find((p) => p.id === productId) ?? null;
  const groupName = (id: string) => menu.modifierGroups.find((g) => g.id === id)?.name;
  const categoryIds = menu.categories.map((c) => c.id);
  const productIds = products.map((p) => p.id);

  const moveCategory = (dir: -1 | 1) => {
    const ids = category && swap(categoryIds, categoryIds.indexOf(category.id), dir);
    if (ids) void act('PUT', `/locations/${menu.location.id}/categories/order`, { ids });
  };
  const moveProduct = (dir: -1 | 1) => {
    const ids = product && category && swap(productIds, productIds.indexOf(product.id), dir);
    if (ids && category) void act('PUT', `/categories/${category.id}/products/order`, { ids });
  };

  return (
    <>
      <div className="toolbar">
        {canManage && (
          <>
            <button className="btn" disabled={!category} onClick={() => setDialog({ kind: 'product' })}>
              <Icon name="add" />
              {t('menu.addProduct')}
            </button>
            <button className="btn" disabled={!product} onClick={() => product && setDialog({ kind: 'product', product })}>
              <Icon name="edit" />
              {t('common.edit')}
            </button>
          </>
        )}
        {canAvailability && (
          <button
            className="btn"
            disabled={!product}
            onClick={() =>
              product &&
              act('POST', `/products/${product.id}/availability`, { isAvailable: !product.isAvailable }, product.isAvailable ? t('menu.markedSoldOut') : t('menu.markedAvailable'))
            }
          >
            <Icon name="power" />
            {product && !product.isAvailable ? t('menu.markAvailable') : t('menu.markSoldOut')}
          </button>
        )}
        {canManage && (
          <>
            <button className="btn" disabled={!product || productIds[0] === product.id} onClick={() => moveProduct(-1)}>
              <Icon name="up" />
              {t('menu.moveUp')}
            </button>
            <button className="btn" disabled={!product || productIds[productIds.length - 1] === product.id} onClick={() => moveProduct(1)}>
              <Icon name="down" />
              {t('menu.moveDown')}
            </button>
            <button className="btn" disabled={!product} onClick={() => product && setDialog({ kind: 'archiveProduct', product })}>
              <Icon name="archive" />
              {t('menu.archiveProduct')}
            </button>
          </>
        )}
        <span className="sep" />
        <button className="btn" onClick={onRefresh}>
          <Icon name="refresh" />
          {t('common.refresh')}
        </button>
      </div>

      <div className="menu-layout">
        <aside className="cat-panel">
          <div className="cat-panel-head">
            <strong>{t('menu.categories')}</strong>
            {canManage && (
              <span>
                <button className="btn" title={t('menu.addCategory')} aria-label={t('menu.addCategory')} onClick={() => setDialog({ kind: 'category' })}>
                  <Icon name="add" />
                </button>
                <button className="btn" title={t('menu.editCategory')} aria-label={t('menu.editCategory')} disabled={!category} onClick={() => category && setDialog({ kind: 'category', category })}>
                  <Icon name="edit" />
                </button>
                <button className="btn" title={t('menu.moveUp')} aria-label={t('menu.moveUp')} disabled={!category || categoryIds[0] === category.id} onClick={() => moveCategory(-1)}>
                  <Icon name="up" />
                </button>
                <button className="btn" title={t('menu.moveDown')} aria-label={t('menu.moveDown')} disabled={!category || categoryIds[categoryIds.length - 1] === category.id} onClick={() => moveCategory(1)}>
                  <Icon name="down" />
                </button>
                <button className="btn" title={t('menu.archiveCategory')} aria-label={t('menu.archiveCategory')} disabled={!category} onClick={() => category && setDialog({ kind: 'archiveCategory', category })}>
                  <Icon name="archive" />
                </button>
              </span>
            )}
          </div>
          <div className="cat-list">
            {menu.categories.map((c) => (
              <button
                key={c.id}
                aria-current={c.id === categoryId}
                onClick={() => {
                  setCategoryId(c.id);
                  setProductId(null);
                }}
              >
                <span>
                  {c.name}
                  {!c.isVisible && <span className="tag">{t('menu.hidden')}</span>}
                </span>
                <span className="muted num">{menu.products.filter((p) => p.categoryId === c.id).length}</span>
              </button>
            ))}
            {menu.categories.length === 0 && <p className="muted cat-empty">{canManage ? t('menu.noCategory') : t('menu.noCategoryReadOnly')}</p>}
          </div>
        </aside>

        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 56 }} />
                <th>{t('menu.colName')}</th>
                <th>{t('menu.colPrice')}</th>
                <th>{t('menu.colVariants')}</th>
                <th>{t('menu.colOptions')}</th>
                <th>{t('menu.colAvailability')}</th>
              </tr>
            </thead>
            <tbody>
              {category && products.length === 0 && (
                <tr>
                  <td className="empty" colSpan={6}>
                    {t('menu.noProduct')}
                  </td>
                </tr>
              )}
              {products.map((p) => (
                <tr key={p.id} className="selectable" aria-selected={p.id === productId} onClick={() => setProductId(p.id)} onDoubleClick={() => canManage && setDialog({ kind: 'product', product: p })}>
                  <td>{p.photoUrl ? <img className="thumb" src={mediaSrc(p.photoUrl)} alt="" loading="lazy" /> : <span className="thumb" />}</td>
                  <td>
                    {p.name}
                    {p.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </td>
                  <td className="num">
                    {formatMoney(p.promoPrice ?? p.price, currency)}
                    {p.promoPrice !== null && <span className="price-old">{formatMoney(p.price, currency)}</span>}
                  </td>
                  <td>{p.variants.length ? p.variants.map((v) => v.name).join(', ') : '—'}</td>
                  <td>{p.modifierGroupIds.map(groupName).filter(Boolean).join(', ') || '—'}</td>
                  <td>
                    <span className={p.isAvailable ? 'state state-ok' : 'state state-off'}>
                      <span className={p.isAvailable ? 'dot dot-ok' : 'dot dot-off'} />
                      {p.isAvailable ? t('menu.available') : t('menu.soldOut')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {dialog?.kind === 'category' && (
        <CategoryDialog
          category={dialog.category}
          onClose={() => setDialog(null)}
          onSubmit={async (body) => {
            if (dialog.category) await save('PATCH', `/categories/${dialog.category.id}`, body);
            else await save('POST', `/locations/${menu.location.id}/categories`, body);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'product' && category && (
        <ProductDialog
          menu={menu}
          categoryId={category.id}
          product={dialog.product}
          onClose={() => setDialog(null)}
          onSubmit={async (body) => {
            if (dialog.product) await save('PATCH', `/products/${dialog.product.id}`, body);
            else await save('POST', `/categories/${category.id}/products`, body);
            setDialog(null);
          }}
        />
      )}
      {(dialog?.kind === 'archiveProduct' || dialog?.kind === 'archiveCategory') && (
        <ConfirmDialog
          title={dialog.kind === 'archiveProduct' ? `${t('menu.archiveProduct')} — ${dialog.product.name}` : `${t('menu.archiveCategory')} — ${dialog.category.name}`}
          text={dialog.kind === 'archiveProduct' ? t('menu.archiveProductConfirm') : t('menu.archiveCategoryConfirm')}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (dialog.kind === 'archiveProduct') await act('POST', `/products/${dialog.product.id}/archive`);
            else await act('POST', `/categories/${dialog.category.id}/archive`);
            setDialog(null);
            setProductId(null);
          }}
        />
      )}
    </>
  );
}

function ConfirmDialog({ title, text, onConfirm, onClose }: { title: string; text: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
          >
            {t('common.confirm')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      <div className="dialog-body">{text}</div>
    </Dialog>
  );
}

function FormDialog({ title, wide, busy, error, onClose, onSubmit, children }: { title: string; wide?: boolean; busy: boolean; error: unknown; onClose: () => void; onSubmit: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Dialog
        wide={wide}
        title={title}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          {children}
        </div>
      </Dialog>
    </form>
  );
}

function useSubmit(onSubmit: (body: object) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, submit };
}

function CategoryDialog({ category, onSubmit, onClose }: { category?: Category; onSubmit: (body: object) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(category?.name ?? '');
  const [isVisible, setVisible] = useState(category?.isVisible ?? true);
  const { busy, error, submit } = useSubmit(onSubmit);
  return (
    <FormDialog title={category ? `${t('menu.editCategory')} — ${category.name}` : t('menu.addCategory')} busy={busy} error={error} onClose={onClose} onSubmit={() => submit({ name, isVisible })}>
      <div className="form">
        <label htmlFor="c-name">{t('menu.categoryName')}</label>
        <input id="c-name" required maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <span />
        <label className="check">
          <input type="checkbox" checked={isVisible} onChange={(e) => setVisible(e.target.checked)} />
          {t('menu.visible')}
        </label>
      </div>
    </FormDialog>
  );
}

interface EditableOption {
  key: string;
  id?: string;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
}

let rowCounter = 0;
const newRow = (): EditableOption => ({ key: `new-${++rowCounter}`, name: '', priceDelta: 0, isAvailable: true });

function OptionRows({ rows, onChange, currency, addLabel }: { rows: EditableOption[]; onChange: (rows: EditableOption[]) => void; currency: AdminMenu['location']['currency']; addLabel: string }) {
  const { t } = useI18n();
  const update = (key: string, patch: Partial<EditableOption>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="edit-rows">
      {rows.length > 0 && (
        <div className="edit-row edit-head">
          <span>{t('menu.variantName')}</span>
          <span>{t('menu.supplement')}</span>
          <span>{t('menu.available')}</span>
          <span />
        </div>
      )}
      {rows.map((row) => (
        <div className="edit-row" key={row.key}>
          <input aria-label={t('menu.variantName')} required maxLength={40} value={row.name} onChange={(e) => update(row.key, { name: e.target.value })} />
          <MoneyInput value={row.priceDelta} currency={currency} signed onChange={(v) => update(row.key, { priceDelta: v ?? 0 })} />
          <label className="check">
            <input type="checkbox" checked={row.isAvailable} onChange={(e) => update(row.key, { isAvailable: e.target.checked })} aria-label={t('menu.available')} />
          </label>
          <button type="button" className="btn" aria-label={t('menu.remove')} title={t('menu.remove')} onClick={() => onChange(rows.filter((r) => r.key !== row.key))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...rows, newRow()])}>
        <Icon name="add" />
        {addLabel}
      </button>
    </div>
  );
}

function ProductDialog({ menu, categoryId, product, onSubmit, onClose }: { menu: AdminMenu; categoryId: string; product?: Product; onSubmit: (body: object) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const currency = menu.location.currency;
  const [form, setForm] = useState({
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? categoryId,
    description: product?.description ?? '',
    price: product?.price ?? (null as number | null),
    promoPrice: product?.promoPrice ?? (null as number | null),
    prepTimeMin: product?.prepTimeMin?.toString() ?? '',
    stationId: product?.stationId ?? (null as string | null),
    tags: (product?.tags ?? []).join(', '),
    allergens: product?.allergens ?? ([] as Allergen[]),
    isAvailable: product?.isAvailable ?? true,
    photoMediaId: product?.photoMediaId ?? (null as string | null),
    photoUrl: product?.photoUrl ?? (null as string | null),
    modifierGroupIds: product?.modifierGroupIds ?? [],
    variants: (product?.variants ?? []).map((v) => ({ key: v.id, id: v.id, name: v.name, priceDelta: v.priceDelta, isAvailable: v.isAvailable })) as EditableOption[],
  });
  const [photoBusy, setPhotoBusy] = useState(false);
  const { busy, error, setError, submit } = useSubmit(onSubmit);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const image = await compressImage(file);
      const media = await api<Media>('POST', `/locations/${menu.location.id}/media`, { contentType: image.contentType, dataBase64: image.dataBase64 });
      setForm((f) => ({ ...f, photoMediaId: media.id, photoUrl: media.url }));
    } catch (err) {
      setError(err);
    } finally {
      setPhotoBusy(false);
    }
  }

  function send() {
    if (form.price === null) return;
    void submit({
      name: form.name,
      description: form.description.trim() || null,
      price: form.price,
      promoPrice: form.promoPrice,
      prepTimeMin: form.prepTimeMin.trim() ? Number(form.prepTimeMin) : null,
      stationId: form.stationId,
      isAvailable: form.isAvailable,
      tags: form.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      allergens: form.allergens,
      photoMediaId: form.photoMediaId,
      modifierGroupIds: form.modifierGroupIds,
      variants: form.variants.map((v) => ({ ...(v.id && { id: v.id }), name: v.name, priceDelta: v.priceDelta, isAvailable: v.isAvailable })),
      ...(product && { categoryId: form.categoryId }),
    });
  }

  return (
    <FormDialog wide title={product ? `${t('menu.editProduct')} — ${product.name}` : t('menu.addProduct')} busy={busy || photoBusy} error={error} onClose={onClose} onSubmit={send}>
      <fieldset className="group">
        <legend>{t('menu.groupProduct')}</legend>
        <div className="form">
          <label htmlFor="p-name">{t('menu.productName')}</label>
          <input id="p-name" required maxLength={80} autoFocus={!product} value={form.name} onChange={(e) => set('name', e.target.value)} />
          {product && (
            <>
              <label htmlFor="p-category">{t('menu.categories')}</label>
              <select id="p-category" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                {menu.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="p-description">{t('menu.description')}</label>
          <textarea id="p-description" maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} />
          <label htmlFor="p-tags">{t('menu.tags')}</label>
          <input id="p-tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
          <span className="hint">{t('menu.tagsHint')}</span>
          <label htmlFor="p-prep">{t('menu.prepTime')}</label>
          <input id="p-prep" type="number" inputMode="numeric" min={0} max={240} value={form.prepTimeMin} onChange={(e) => set('prepTimeMin', e.target.value)} />
          <label htmlFor="p-station">Poste de préparation</label>
          <select id="p-station" value={form.stationId ?? ''} onChange={(e) => set('stationId', e.target.value || null)}>
            <option value="">Par défaut ({menu.stations.find((s) => s.kind === 'KITCHEN')?.name ?? 'aucun poste'})</option>
            {menu.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span />
          <label className="check">
            <input type="checkbox" checked={form.isAvailable} onChange={(e) => set('isAvailable', e.target.checked)} />
            {t('menu.isAvailable')}
          </label>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>{t('menu.groupPrice')}</legend>
        <div className="form">
          <label htmlFor="p-price">{t('menu.price')}</label>
          <MoneyInput id="p-price" required value={form.price} currency={currency} onChange={(v) => set('price', v)} />
          <label htmlFor="p-promo">{t('menu.promoPrice')}</label>
          <MoneyInput id="p-promo" allowEmpty value={form.promoPrice} currency={currency} onChange={(v) => set('promoPrice', v)} />
          <span className="hint">{t('menu.promoHint')}</span>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>{t('menu.groupPhoto')}</legend>
        <div className="photo-edit">
          {form.photoUrl ? <img src={mediaSrc(form.photoUrl)} alt="" /> : <span className="photo-empty" />}
          <div>
            <label className="btn">
              <Icon name="image" />
              {photoBusy ? t('menu.photoBusy') : t('menu.photoPick')}
              <input type="file" accept="image/*" hidden disabled={photoBusy} onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </label>
            {form.photoMediaId && (
              <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, photoMediaId: null, photoUrl: null }))}>
                {t('menu.photoRemove')}
              </button>
            )}
            <p className="muted" style={{ marginTop: 6 }}>
              {t('menu.photoHint')}
            </p>
          </div>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>{t('menu.groupVariants')}</legend>
        <OptionRows rows={form.variants} onChange={(rows) => set('variants', rows)} currency={currency} addLabel={t('menu.addVariant')} />
      </fieldset>

      <fieldset className="group">
        <legend>{t('menu.groupOptions')}</legend>
        {menu.modifierGroups.length === 0 ? (
          <p className="muted">{t('menu.noGroups')}</p>
        ) : (
          <div className="check-grid">
            {menu.modifierGroups.map((g) => (
              <label className="check" key={g.id}>
                <input type="checkbox" checked={form.modifierGroupIds.includes(g.id)} onChange={() => set('modifierGroupIds', toggle(form.modifierGroupIds, g.id))} />
                {g.name} <span className="muted">&nbsp;({choiceRule(g.minSelect, g.maxSelect)})</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="group">
        <legend>{t('menu.groupAllergens')}</legend>
        <div className="check-grid">
          {ALLERGENS.map((a) => (
            <label className="check" key={a}>
              <input type="checkbox" checked={form.allergens.includes(a)} onChange={() => set('allergens', toggle(form.allergens, a))} />
              {ALLERGEN_LABELS[a]}
            </label>
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}

// --- Groupes d'options -------------------------------------------------------

function OptionsTab({ menu, canManage, canAvailability, save, act, onRefresh }: { menu: AdminMenu; canManage: boolean; canAvailability: boolean; save: Save; act: Save; onRefresh: () => void }) {
  const { t } = useI18n();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'group'; group?: ModifierGroup } | { kind: 'archive'; group: ModifierGroup }>(null);
  const group = menu.modifierGroups.find((g) => g.id === groupId) ?? null;
  const currency = menu.location.currency;
  const delta = (v: number) => (v === 0 ? '—' : `${v > 0 ? '+' : '−'}${formatMoney(Math.abs(v), currency)}`);

  return (
    <>
      <div className="toolbar">
        {canManage && (
          <>
            <button className="btn" onClick={() => setDialog({ kind: 'group' })}>
              <Icon name="add" />
              {t('options.add')}
            </button>
            <button className="btn" disabled={!group} onClick={() => group && setDialog({ kind: 'group', group })}>
              <Icon name="edit" />
              {t('options.edit')}
            </button>
            <button className="btn" disabled={!group} onClick={() => group && setDialog({ kind: 'archive', group })}>
              <Icon name="archive" />
              {t('options.archive')}
            </button>
            <span className="sep" />
          </>
        )}
        <button className="btn" onClick={onRefresh}>
          <Icon name="refresh" />
          {t('common.refresh')}
        </button>
      </div>
      <div className="floor">
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>{t('options.name')}</th>
                <th>{t('options.rule')}</th>
                <th>{t('options.options')}</th>
                <th>{t('options.usedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {menu.modifierGroups.length === 0 && (
                <tr>
                  <td className="empty" colSpan={4}>
                    {t('options.none')}
                  </td>
                </tr>
              )}
              {menu.modifierGroups.map((g) => (
                <tr key={g.id} className="selectable" aria-selected={g.id === groupId} onClick={() => setGroupId(g.id)} onDoubleClick={() => canManage && setDialog({ kind: 'group', group: g })}>
                  <td>{g.name}</td>
                  <td>{choiceRule(g.minSelect, g.maxSelect)}</td>
                  <td>{g.modifiers.map((m) => (m.priceDelta ? `${m.name} (${delta(m.priceDelta)})` : m.name)).join(', ')}</td>
                  <td className="num">{g.productCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="floor-side">
          {group ? (
            <fieldset className="group">
              <legend>{group.name}</legend>
              <table className="grid">
                <tbody>
                  {group.modifiers.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {m.name}
                        <div className="muted num">{delta(m.priceDelta)}</div>
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        {canAvailability ? (
                          <button className="btn" onClick={() => act('POST', `/modifiers/${m.id}/availability`, { isAvailable: !m.isAvailable })}>
                            {m.isAvailable ? t('menu.available') : t('options.soldOut')}
                          </button>
                        ) : (
                          <span className={m.isAvailable ? 'state state-ok' : 'state state-off'}>{m.isAvailable ? t('menu.available') : t('options.soldOut')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </fieldset>
          ) : (
            <p className="muted">{t('options.selectHint')}</p>
          )}
        </aside>
      </div>

      {dialog?.kind === 'group' && (
        <GroupDialog
          group={dialog.group}
          currency={currency}
          onClose={() => setDialog(null)}
          onSubmit={async (body) => {
            if (dialog.group) await save('PATCH', `/modifier-groups/${dialog.group.id}`, body);
            else await save('POST', `/locations/${menu.location.id}/modifier-groups`, body);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'archive' && (
        <ConfirmDialog
          title={`${t('options.archive')} — ${dialog.group.name}`}
          text={t('options.archiveConfirm')}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await act('POST', `/modifier-groups/${dialog.group.id}/archive`);
            setDialog(null);
            setGroupId(null);
          }}
        />
      )}
    </>
  );
}

function GroupDialog({ group, currency, onSubmit, onClose }: { group?: ModifierGroup; currency: AdminMenu['location']['currency']; onSubmit: (body: object) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(group?.name ?? '');
  const [minSelect, setMin] = useState(group?.minSelect ?? 0);
  const [maxSelect, setMax] = useState(group?.maxSelect ?? 1);
  const [rows, setRows] = useState<EditableOption[]>(
    group ? group.modifiers.map((m) => ({ key: m.id, id: m.id, name: m.name, priceDelta: m.priceDelta, isAvailable: m.isAvailable })) : [newRow(), newRow()],
  );
  const { busy, error, submit } = useSubmit(onSubmit);
  return (
    <FormDialog
      wide
      title={group ? `${t('options.edit')} — ${group.name}` : t('options.add')}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        submit({ name, minSelect, maxSelect, modifiers: rows.map((r) => ({ ...(r.id && { id: r.id }), name: r.name, priceDelta: r.priceDelta, isAvailable: r.isAvailable })) })
      }
    >
      <div className="form">
        <label htmlFor="g-name">{t('options.name')}</label>
        <input id="g-name" required maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="g-min">{t('options.min')}</label>
        <input id="g-min" type="number" inputMode="numeric" min={0} max={30} required value={minSelect} onChange={(e) => setMin(Number(e.target.value))} />
        <label htmlFor="g-max">{t('options.max')}</label>
        <input id="g-max" type="number" inputMode="numeric" min={1} max={30} required value={maxSelect} onChange={(e) => setMax(Number(e.target.value))} />
        <span className="hint">
          {choiceRule(minSelect, Math.max(1, maxSelect))} — {t('options.rulesHint')}
        </span>
      </div>
      <fieldset className="group" style={{ marginTop: 12 }}>
        <legend>{t('options.options')}</legend>
        <OptionRows rows={rows} onChange={setRows} currency={currency} addLabel={t('options.addOption')} />
      </fieldset>
    </FormDialog>
  );
}
