import '../styles/onboarding.css';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CATALOGUE_CATEGORIES,
  CURRENCIES,
  CURRENCY_CODES,
  LOCATION_TYPES,
  ROLES,
  SETUP_STEPS,
  SETUP_STEP_LABELS,
  canManageRole,
  formatMoney,
  type AdminMenu,
  type CurrencyCode,
  type Floor,
  type LocationDetails,
  type LocationType,
  type Me,
  type Media,
  type Member,
  type Role,
  type SetupStatus,
  type SetupStep,
  type SetupTestOrder,
} from '@afrikaisse/core';
import { api } from '../api.ts';
import { compressImage } from '../images.ts';
import { COUNTRIES, LOCATION_TYPE_LABELS, ROLE_LABELS, TIMEZONES } from '../labels.ts';
import { mediaSrc } from '../platform.ts';
import { ErrorMessage, Icon, MoneyInput, OkMessage } from '../ui.tsx';
import { CatalogueImport } from './CatalogueImport.tsx';
import { PrintersTab } from './Printers.tsx';
import { QrTab } from './Qr.tsx';
import { StationsTab } from './Stations.tsx';

/**
 * Assistant de mise en route (§70), à la manière d'un assistant WINDEV : étapes numérotées à gauche,
 * contenu à droite, Précédent / Suivant / Terminer en bas. Chaque étape écrit par les routes habituelles ;
 * l'avancement vient du serveur (données réelles), Suivant sur une étape vide la passe.
 */

type View = SetupStep | 'ready';
type Saver = (() => Promise<void>) | null;

interface StepProps {
  me: Me;
  location: LocationDetails;
  status: SetupStatus;
  /** Enregistre ce que Suivant doit écrire avant de changer d'étape. */
  register: (save: Saver) => void;
  reload: () => Promise<void>;
}

export function OnboardingWizard({ me, locationId, onClose, onFinished, onChanged }: { me: Me; locationId: string; onClose: () => void; onFinished: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [location, setLocation] = useState<LocationDetails | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const saver = useRef<Saver>(null);

  const refresh = useCallback(async () => {
    const [next, list] = await Promise.all([api<SetupStatus>('GET', `/locations/${locationId}/setup`), api<LocationDetails[]>('GET', '/locations')]);
    setStatus(next);
    setLocation(list.find((l) => l.id === locationId) ?? null);
    return next;
  }, [locationId]);

  useEffect(() => {
    refresh().then((s) => setView((v) => v ?? s.nextStep ?? 'ready'), setError);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const index = view === null ? 0 : view === 'ready' ? SETUP_STEPS.length : SETUP_STEPS.indexOf(view);
  const go = (next: View) => {
    saver.current = null;
    setError(null);
    setView(next);
  };
  const reload = async () => {
    try {
      await refresh();
    } catch (err) {
      setError(err);
    }
  };

  async function forward() {
    if (!status || view === null || view === 'ready') return;
    setBusy(true);
    setError(null);
    try {
      if (saver.current) await saver.current();
      let next = await refresh();
      const current = next.steps.find((s) => s.id === view)!;
      // Première étape validée : l'assistant est commencé. Étape restée vide : passée.
      if (view === 'restaurant') next = await api<SetupStatus>('POST', `/locations/${locationId}/setup/steps/restaurant`, { skipped: false });
      else if (!current.done && !current.skipped) next = await api<SetupStatus>('POST', `/locations/${locationId}/setup/steps/${view}`, { skipped: true });
      setStatus(next);
      if (view === 'restaurant' || view === 'currency') onChanged();
      go(index + 1 < SETUP_STEPS.length ? SETUP_STEPS[index + 1]! : 'ready');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api<SetupStatus>('POST', `/locations/${locationId}/setup/finish`);
      onFinished();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const doneCount = status?.steps.filter((s) => s.done).length ?? 0;
  const props: StepProps | null = status && location ? { me, location, status, reload, register: (save) => (saver.current = save) } : null;

  return (
    <div className="onb-overlay" role="presentation">
      <div className="onb-window" role="dialog" aria-modal="true" aria-label="Assistant de mise en route">
        <header className="onb-head">
          <h1>
            Assistant de mise en route
            {location && <span className="onb-place">{location.name}</span>}
          </h1>
          <button type="button" className="icon-btn" aria-label="Fermer" disabled={busy} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div className="onb-body">
          <ol className="onb-steps">
            {SETUP_STEPS.map((id, i) => {
              const state = status?.steps.find((s) => s.id === id);
              return (
                <li key={id} className={state?.done ? 'done' : state?.skipped ? 'skipped' : undefined}>
                  <button type="button" aria-current={view === id ? 'step' : undefined} disabled={busy} onClick={() => go(id)}>
                    <span className="onb-num">{state?.done ? <Icon name="start" /> : i + 1}</span>
                    <span className="onb-label">{SETUP_STEP_LABELS[id]}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <section className="onb-content">
            {view === 'ready' ? <h2>Votre restaurant est prêt.</h2> : view && <h2>{`${index + 1}. ${SETUP_STEP_LABELS[view]}`}</h2>}
            <ErrorMessage error={error} />
            {props && view && <StepView key={view} view={view} {...props} />}
          </section>
        </div>

        <footer className="onb-foot">
          <span className="onb-progress">
            {doneCount} / {SETUP_STEPS.length}
          </span>
          <button type="button" className="btn" disabled={busy || index === 0} onClick={() => go(SETUP_STEPS[index - 1]!)}>
            <Icon name="left" />
            Précédent
          </button>
          {view !== 'ready' && (
            <button type="button" className="btn btn-primary" disabled={busy || !status} onClick={forward}>
              Suivant
              <Icon name="right" />
            </button>
          )}
          <button type="button" className={view === 'ready' ? 'btn btn-primary' : 'btn'} disabled={busy || view !== 'ready'} onClick={finish}>
            Terminer
          </button>
        </footer>
      </div>
    </div>
  );
}

function StepView({ view, ...props }: StepProps & { view: View }) {
  switch (view) {
    case 'restaurant':
      return <RestaurantStep {...props} />;
    case 'logo':
      return <LogoStep {...props} />;
    case 'address':
      return <AddressStep {...props} />;
    case 'currency':
      return <CurrencyStep {...props} />;
    case 'categories':
      return <CategoriesStep {...props} />;
    case 'products':
      return <ProductsStep {...props} />;
    case 'tables':
      return <TablesStep {...props} />;
    case 'qr':
      return props.status.tables === 0 ? <div className="empty-state">Aucune table.</div> : <QrTab locationId={props.location.id} canManage={props.me.permissions.includes('tables.manage')} />;
    case 'stations':
      return <StationsStep {...props} />;
    case 'users':
      return <UsersStep {...props} />;
    case 'printers':
      return <PrintersStep {...props} />;
    case 'test':
      return <TestStep {...props} />;
    case 'ready':
      return <ReadyView {...props} />;
  }
}

/** Enregistre la sauvegarde de l'étape avec les valeurs du dernier affichage. */
function useSaver(register: StepProps['register'], save: () => Promise<void>) {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    register(() => latest.current());
    return () => register(null);
  }, [register]);
}

function useMenu(locationId: string) {
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<AdminMenu>('GET', `/locations/${locationId}/menu`).then(setMenu, setError), [locationId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { menu, setMenu, load, error, setError };
}

// --- 1 à 4 : l'établissement -----------------------------------------------------------

function RestaurantStep({ location, register }: StepProps) {
  const [name, setName] = useState(location.name);
  const [type, setType] = useState<LocationType>(location.type);
  useSaver(register, async () => {
    if (name.trim() !== location.name || type !== location.type) await api('PATCH', `/locations/${location.id}`, { name: name.trim(), type });
  });
  return (
    <div className="form onb-form">
      <label htmlFor="onb-name">Nom</label>
      <input id="onb-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="onb-type">Type</label>
      <select id="onb-type" value={type} onChange={(e) => setType(e.target.value as LocationType)}>
        {LOCATION_TYPES.map((t) => (
          <option key={t} value={t}>
            {LOCATION_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
    </div>
  );
}

function LogoStep({ location, reload }: StepProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function change(logoMediaId: string | null) {
    await api('PATCH', `/locations/${location.id}`, { logoMediaId });
    await reload();
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const image = await compressImage(file, 512, 0.9);
      const media = await api<Media>('POST', `/locations/${location.id}/media`, { contentType: image.contentType, dataBase64: image.dataBase64 });
      await change(media.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ErrorMessage error={error} />
      <div className="onb-logo">{location.logoUrl ? <img src={mediaSrc(location.logoUrl)} alt="Logo" /> : <span className="muted">Aucun logo</span>}</div>
      <div className="onb-actions">
        <label className={busy ? 'btn btn-primary onb-file disabled' : 'btn btn-primary onb-file'}>
          <Icon name="image" />
          Choisir une image
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
        {location.logoUrl && (
          <button type="button" className="btn" disabled={busy} onClick={() => void change(null).catch(setError)}>
            <Icon name="trash" />
            Retirer
          </button>
        )}
      </div>
    </>
  );
}

function AddressStep({ location, register }: StepProps) {
  const [address, setAddress] = useState(location.address ?? '');
  const [phone, setPhone] = useState(location.phone ?? '');
  useSaver(register, async () => {
    const next = { address: address.trim() || null, phone: phone.trim() || null };
    if (next.address !== location.address || next.phone !== location.phone) await api('PATCH', `/locations/${location.id}`, next);
  });
  return (
    <div className="form onb-form">
      <label htmlFor="onb-address">Adresse</label>
      <input id="onb-address" maxLength={300} autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} />
      <label htmlFor="onb-phone">Téléphone</label>
      <input id="onb-phone" type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
    </div>
  );
}

function CurrencyStep({ location, register }: StepProps) {
  const [country, setCountry] = useState(location.country);
  const [currency, setCurrency] = useState<CurrencyCode>(location.currency);
  const [timezone, setTimezone] = useState(location.timezone);
  const timezones = TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES];
  useSaver(register, async () => {
    const changes = Object.fromEntries(Object.entries({ country, currency, timezone }).filter(([k, v]) => v !== location[k as 'country' | 'currency' | 'timezone']));
    if (Object.keys(changes).length) await api('PATCH', `/locations/${location.id}`, changes);
  });
  function pickCountry(code: string) {
    setCountry(code);
    const c = COUNTRIES.find((x) => x.code === code);
    if (c) {
      setCurrency(c.currency);
      setTimezone(c.timezone);
    }
  }
  return (
    <div className="form onb-form">
      <label htmlFor="onb-country">Pays</label>
      <select id="onb-country" value={country} onChange={(e) => pickCountry(e.target.value)}>
        {!COUNTRIES.some((c) => c.code === country) && <option value={country}>{country}</option>}
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      <label htmlFor="onb-currency">Devise</label>
      <select id="onb-currency" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
        {CURRENCY_CODES.map((code) => (
          <option key={code} value={code}>
            {CURRENCIES[code].label} ({code})
          </option>
        ))}
      </select>
      <label htmlFor="onb-tz">Fuseau horaire</label>
      <select id="onb-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
        {timezones.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>
    </div>
  );
}

// --- 5 et 6 : la carte ------------------------------------------------------------------

function CatalogueButton({ menu, location, onDone }: { menu: AdminMenu | null; location: LocationDetails; onDone: (notice: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" disabled={!menu} onClick={() => setOpen(true)}>
        <Icon name="menu" />
        Importer des plats
      </button>
      {open && menu && (
        <CatalogueImport
          menu={menu}
          country={location.country}
          onClose={() => setOpen(false)}
          onDone={(imported, failed) => {
            setOpen(false);
            onDone(failed.length ? `${imported} plat(s) importé(s), ${failed.length} en échec.` : `${imported} plat(s) importé(s).`);
          }}
        />
      )}
    </>
  );
}

function CategoriesStep({ location, reload }: StepProps) {
  const { menu, setMenu, load, error, setError } = useMenu(location.id);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(value: string) {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setMenu(await api<AdminMenu>('POST', `/locations/${location.id}/categories`, { name: value.trim() }));
      setName('');
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const present = new Set(menu?.categories.map((c) => c.name.toLowerCase()) ?? []);

  return (
    <>
      <ErrorMessage error={error} />
      {notice && <OkMessage>{notice}</OkMessage>}
      <form
        className="onb-inline"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void add(name);
        }}
      >
        <label htmlFor="onb-cat">Catégorie</label>
        <input id="onb-cat" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          <Icon name="add" />
          Ajouter
        </button>
      </form>
      <div className="onb-actions">
        {CATALOGUE_CATEGORIES.filter((c) => !present.has(c.toLowerCase())).map((c) => (
          <button key={c} type="button" className="btn" disabled={busy || !menu} onClick={() => void add(c)}>
            <Icon name="add" />
            {c}
          </button>
        ))}
        <CatalogueButton
          menu={menu}
          location={location}
          onDone={(text) => {
            setNotice(text);
            void load();
            void reload();
          }}
        />
      </div>
      <div className="grid-wrap onb-list">
        <table className="grid compact">
          <thead>
            <tr>
              <th>Catégorie</th>
              <th className="num">Produits</th>
            </tr>
          </thead>
          <tbody>
            {menu?.categories.length === 0 && (
              <tr>
                <td className="empty" colSpan={2}>
                  Aucune catégorie.
                </td>
              </tr>
            )}
            {menu?.categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="num">{menu.products.filter((p) => p.categoryId === c.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ProductsStep({ location, reload }: StepProps) {
  const { menu, setMenu, load, error, setError } = useMenu(location.id);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const category = categoryId || menu?.categories[0]?.id || '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!category || price === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setMenu(await api<AdminMenu>('POST', `/categories/${category}/products`, { name: name.trim(), price }));
      setNotice(`« ${name.trim()} » ajouté.`);
      setName('');
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ErrorMessage error={error} />
      {notice && <OkMessage>{notice}</OkMessage>}
      {menu && menu.categories.length > 0 && (
        <form className="onb-product" onSubmit={submit}>
          <label>
            Produit
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Catégorie
            <select value={category} onChange={(e) => setCategoryId(e.target.value)}>
              {menu.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prix
            <MoneyInput value={price} currency={menu.location.currency} onChange={setPrice} required />
          </label>
          <button className="btn btn-primary" disabled={busy || !name.trim() || price === null}>
            <Icon name="add" />
            Ajouter
          </button>
        </form>
      )}
      <div className="onb-actions">
        <CatalogueButton
          menu={menu}
          location={location}
          onDone={(text) => {
            setNotice(text);
            void load();
            void reload();
          }}
        />
      </div>
      <div className="grid-wrap onb-list">
        <table className="grid compact">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Catégorie</th>
              <th className="num">Prix</th>
            </tr>
          </thead>
          <tbody>
            {menu?.products.length === 0 && (
              <tr>
                <td className="empty" colSpan={3}>
                  Aucun produit.
                </td>
              </tr>
            )}
            {menu?.products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{menu.categories.find((c) => c.id === p.categoryId)?.name ?? ''}</td>
                <td className="num">{formatMoney(p.price, menu.location.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- 7 à 11 : salle, postes, équipe, imprimantes -------------------------------------------------

type ZoneRow = { name: string; count: number; capacity: number };

function TablesStep({ location, reload }: StepProps) {
  const [floor, setFloor] = useState<Floor | null>(null);
  const [rows, setRows] = useState<ZoneRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Floor>('GET', `/locations/${location.id}/floor`).then((f) => {
      setFloor(f);
      setRows(
        f.zones.length === 0
          ? [
              { name: 'Salle', count: 10, capacity: 4 },
              { name: 'Terrasse', count: 4, capacity: 2 },
            ]
          : [{ name: f.zones[0]!.name, count: 2, capacity: 4 }],
      );
    }, setError);
  }, [location.id]);

  const set = (i: number, patch: Partial<ZoneRow>) => setRows((list) => list?.map((r, j) => (j === i ? { ...r, ...patch } : r)) ?? null);

  async function generate(e: FormEvent) {
    e.preventDefault();
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      setFloor(await api<Floor>('POST', `/locations/${location.id}/setup/tables`, { zones: rows.filter((r) => r.name.trim() && r.count > 0).map((r) => ({ name: r.name.trim(), count: r.count, capacity: r.capacity })) }));
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ErrorMessage error={error} />
      {rows && (
        <form onSubmit={generate}>
          <div className="onb-zones" role="table">
            <div className="onb-zone-row onb-zone-head" role="row">
              <span role="columnheader">Zone</span>
              <span role="columnheader">Tables</span>
              <span role="columnheader">Places</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div className="onb-zone-row" role="row" key={i}>
                <input aria-label="Zone" required maxLength={60} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                <input aria-label="Tables" type="number" inputMode="numeric" min={1} max={60} required value={r.count} onChange={(e) => set(i, { count: Number(e.target.value) })} />
                <input aria-label="Places" type="number" inputMode="numeric" min={1} max={50} required value={r.capacity} onChange={(e) => set(i, { capacity: Number(e.target.value) })} />
                <button type="button" className="icon-btn" aria-label="Retirer la zone" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
          <div className="onb-actions">
            <button type="button" className="btn" disabled={rows.length >= 6} onClick={() => setRows([...rows, { name: '', count: 4, capacity: 4 }])}>
              <Icon name="add" />
              Zone
            </button>
            <button className="btn btn-primary" disabled={busy}>
              <Icon name="table" />
              Créer les tables
            </button>
          </div>
        </form>
      )}
      {floor && floor.zones.length > 0 && <PlanPreview floor={floor} />}
    </>
  );
}

/** Aperçu du plan réellement enregistré, zone par zone. */
function PlanPreview({ floor }: { floor: Floor }) {
  return (
    <div className="onb-plan">
      {floor.zones.map((zone) => {
        const tables = floor.tables.filter((t) => t.zoneId === zone.id);
        return (
          <figure key={zone.id}>
            <figcaption>
              {zone.name} · {tables.length} table{tables.length > 1 ? 's' : ''}
            </figcaption>
            <svg viewBox={`0 0 ${zone.planWidth} ${zone.planHeight}`} role="img" aria-label={`Plan ${zone.name}`}>
              <rect className="onb-plan-bg" x={0} y={0} width={zone.planWidth} height={zone.planHeight} />
              {tables.map((t) => (
                <g key={t.id}>
                  <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={t.shape === 'ROUND' ? Math.min(t.w, t.h) / 2 : 0.25} />
                  <text x={t.x + t.w / 2} y={t.y + t.h / 2}>
                    {t.label}
                  </text>
                </g>
              ))}
            </svg>
          </figure>
        );
      })}
    </div>
  );
}

function StationsStep({ location, me, reload }: StepProps) {
  const { menu, load, error } = useMenu(location.id);
  return (
    <>
      <ErrorMessage error={error} />
      {menu && (
        <StationsTab
          menu={menu}
          canManage={me.permissions.includes('menu.manage')}
          onChanged={() => {
            void load();
            void reload();
          }}
        />
      )}
    </>
  );
}

function PrintersStep({ location }: StepProps) {
  const { menu, error } = useMenu(location.id);
  return (
    <>
      <ErrorMessage error={error} />
      {menu && <PrintersTab locationId={location.id} stations={menu.stations} />}
    </>
  );
}

function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => alphabet[b % alphabet.length]).join('');
}

function UsersStep({ me, reload }: StepProps) {
  const roles = ROLES.filter((r) => r !== 'OWNER' && me.role && canManageRole(me.role, r));
  const [members, setMembers] = useState<Member[] | null>(null);
  const [form, setForm] = useState({ displayName: '', email: '', role: 'CASHIER' as Role, password: generatePassword() });
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Member[]>('GET', '/team').then(setMembers, setError), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const member = await api<Member>('POST', '/team', { ...form, displayName: form.displayName.trim(), locationId: null });
      // Mot de passe montré une seule fois : il n'est lisible nulle part ailleurs.
      setNotice(`${member.displayName} · ${member.email} · mot de passe : ${form.password}`);
      setForm({ displayName: '', email: '', role: form.role, password: generatePassword() });
      await load();
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ErrorMessage error={error} />
      {notice && <OkMessage>{notice}</OkMessage>}
      <form className="form onb-form" onSubmit={submit}>
        <label htmlFor="onb-member">Nom</label>
        <input id="onb-member" required minLength={2} maxLength={120} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <label htmlFor="onb-email">E-mail</label>
        <input id="onb-email" type="email" required autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <label htmlFor="onb-role">Rôle</label>
        <select id="onb-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS.fr[r]}
            </option>
          ))}
        </select>
        <label htmlFor="onb-password">Mot de passe</label>
        <input id="onb-password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <span />
        <div>
          <button className="btn btn-primary" disabled={busy}>
            <Icon name="add" />
            Ajouter
          </button>
        </div>
      </form>
      <div className="grid-wrap onb-list">
        <table className="grid compact">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Rôle</th>
              <th>E-mail</th>
            </tr>
          </thead>
          <tbody>
            {members?.map((m) => (
              <tr key={m.membershipId}>
                <td>{m.displayName}</td>
                <td>{ROLE_LABELS.fr[m.role]}</td>
                <td>{m.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- 12 : test, puis bilan --------------------------------------------------------------------

function TestStep({ location, status, reload }: StepProps) {
  const [result, setResult] = useState<SetupTestOrder | null>(null);
  const [cleaned, setCleaned] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (status.products === 0 && !result) return <div className="empty-state">Aucun produit.</div>;
  const stationName = (id: string | null) => result?.stations.find((s) => s.id === id)?.name ?? '';

  return (
    <>
      <ErrorMessage error={error} />
      {!result && status.testDone && <OkMessage>Test réussi.</OkMessage>}
      <div className="onb-actions">
        <button type="button" className="btn btn-primary" disabled={busy || (!!result && !cleaned)} onClick={() => void run(async () => {
          setCleaned(false);
          setResult(await api<SetupTestOrder>('POST', `/locations/${location.id}/setup/test-order`));
        })}>
          <Icon name="ticket" />
          Lancer le test
        </button>
      </div>
      {result && (
        <fieldset className="group onb-test">
          <legend>Commande n°{result.order.number}</legend>
          <div className="grid-wrap">
            <table className="grid compact">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Poste</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {result.order.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.quantity} × {i.name}
                      {i.variantName ? ` (${i.variantName})` : ''}
                    </td>
                    <td>{stationName(i.stationId)}</td>
                    <td>{cleaned ? <span className="st st-cancelled">Annulée</span> : <span className="st st-ready">Reçue</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cleaned ? (
            <OkMessage>Commande de test annulée et tracée au journal.</OkMessage>
          ) : (
            <div className="onb-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => {
                await api<SetupStatus>('POST', `/locations/${location.id}/setup/test-order/${result.order.id}/finish`);
                setCleaned(true);
                await reload();
              })}>
                <Icon name="close" />
                Annuler la commande de test
              </button>
            </div>
          )}
        </fieldset>
      )}
    </>
  );
}

function ReadyView({ location, status }: StepProps) {
  const count = (n: number) => String(n);
  const lines: [SetupStep, string][] = [
    ['restaurant', `${location.name} · ${LOCATION_TYPE_LABELS[location.type]}`],
    ['logo', status.hasLogo ? 'Oui' : 'Non'],
    ['address', [location.address, location.phone].filter(Boolean).join(' · ') || '—'],
    ['currency', `${location.currency} · ${location.timezone}`],
    ['categories', count(status.categories)],
    ['products', count(status.products)],
    ['tables', `${status.tables} · ${status.zones} zone${status.zones > 1 ? 's' : ''}`],
    ['qr', count(status.tables)],
    ['stations', count(status.stations)],
    ['users', count(status.members)],
    ['printers', count(status.printers)],
    ['test', status.testDone ? 'Réussi' : '—'],
  ];
  return (
    <div className="grid-wrap onb-list">
      <table className="grid onb-ready">
        <tbody>
          {lines.map(([id, value]) => {
            const done = status.steps.find((s) => s.id === id)?.done ?? false;
            return (
              <tr key={id}>
                <th scope="row">{SETUP_STEP_LABELS[id]}</th>
                <td>{value}</td>
                <td>{done ? <span className="st st-ready">Configuré</span> : <span className="st">Passé</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
