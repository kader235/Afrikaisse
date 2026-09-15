import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  SUBSCRIPTION_STATE_LABELS,
  formatMoney,
  planOf,
  type ErrorLogEntry,
  type PlatformDevice,
  type PlatformRestaurant,
  type PlatformStats,
  type PlatformSyncState,
  type PlatformTenant,
  type PlatformUser,
} from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ROLE_LABELS, formatDateTime } from '../labels.ts';
import { FloatMessage, Icon, Window } from '../ui.tsx';
import { ExpiryState, SubscriptionDialog } from './Other.tsx';
import '../styles/platform.css';

/** Back-office GLOBALTECH BUSINESS TD (§67). Visible seulement pour `is_platform_admin` ; les routes répondent 404 aux autres. */

type Tab = 'restaurants' | 'users' | 'devices' | 'sync' | 'errors' | 'stats';
const TABS: [Tab, string][] = [
  ['restaurants', 'Restaurants'],
  ['users', 'Utilisateurs'],
  ['devices', 'Installations'],
  ['sync', 'Synchronisations'],
  ['errors', 'Erreurs'],
  ['stats', 'Statistiques'],
];

const MODE_LABELS = { CLOUD: 'En ligne', HYBRID: 'Serveur local' } as const;

function useWhen() {
  const { locale } = useI18n();
  return (ms: number | null) => (ms ? formatDateTime(ms, locale) : '—');
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="state">
      <span className={ok ? 'dot dot-ok' : 'dot dot-off'} />
      {label}
    </span>
  );
}

export function PlatformPage() {
  const [tab, setTab] = useState<Tab>('restaurants');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const report = { onError: setError, onNotice: setNotice };
  return (
    <Window title="Plateforme" bodyless>
      <div className="subtabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'restaurants' && <RestaurantsTab {...report} />}
      {tab === 'users' && <UsersTab {...report} />}
      {tab === 'devices' && <DevicesTab {...report} />}
      {tab === 'sync' && <SyncTab {...report} />}
      {tab === 'errors' && <ErrorsTab {...report} />}
      {tab === 'stats' && <StatsTab {...report} />}
      <FloatMessage
        error={error}
        notice={notice}
        onClose={() => {
          setError(null);
          setNotice(null);
        }}
      />
    </Window>
  );
}

interface TabProps {
  onError: (err: unknown) => void;
  onNotice: (text: string) => void;
}

function SearchBar({ placeholder, onSearch, children }: { placeholder: string; onSearch: (q: string) => void; children?: React.ReactNode }) {
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(q.trim());
  };
  return (
    <form className="platform-search" role="search" onSubmit={submit}>
      <input type="search" aria-label={placeholder} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn" type="submit">
        <Icon name="search" />
        Rechercher
      </button>
      {children}
    </form>
  );
}

// --- Restaurants ------------------------------------------------------------------

function RestaurantsTab({ onError, onNotice }: TabProps) {
  const when = useWhen();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PlatformRestaurant[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const selected = rows?.find((r) => r.id === selectedId) ?? null;

  const load = useCallback(() => api<PlatformRestaurant[]>('GET', `/platform/restaurants${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setRows, onError), [q, onError]);
  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(action: 'suspend' | 'reactivate') {
    if (!selected) return;
    try {
      await api('POST', `/platform/tenants/${selected.id}/${action}`);
      onNotice(action === 'suspend' ? `${selected.name} suspendue.` : `${selected.name} réactivée.`);
      await load();
    } catch (err) {
      onError(err);
    }
  }

  const asTenant = (r: PlatformRestaurant): PlatformTenant => ({ id: r.id, name: r.name, status: r.status, plan: r.plan, isDemo: r.isDemo, createdAt: r.createdAt, planExpiresAt: r.planExpiresAt, members: r.members, locations: r.locations.length });

  return (
    <>
      <SearchBar placeholder="Nom de l’organisation" onSearch={setQ}>
        <button className="btn" type="button" disabled={!selected} onClick={() => setEditing(true)}>
          <Icon name="key" />
          Abonnement…
        </button>
        <button className="btn" type="button" disabled={selected?.status !== 'ACTIVE'} onClick={() => setStatus('suspend')}>
          <Icon name="power" />
          Suspendre
        </button>
        <button className="btn" type="button" disabled={selected?.status !== 'SUSPENDED'} onClick={() => setStatus('reactivate')}>
          <Icon name="power" />
          Réactiver
        </button>
      </SearchBar>
      {editing && selected && (
        <SubscriptionDialog
          tenant={asTenant(selected)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Organisation</th>
              <th>État</th>
              <th>Offre</th>
              <th>Abonnement</th>
              <th>Échéance</th>
              <th>Établissements</th>
              <th>Membres</th>
              <th>Créée le</th>
              <th>Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td className="empty" colSpan={9}>
                  Aucune organisation.
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id} className="selectable" aria-selected={r.id === selectedId} onClick={() => setSelectedId(r.id)}>
                <td>
                  {r.name}
                  {r.isDemo && <span className="tag">Démo</span>}
                </td>
                <td>
                  <Dot ok={r.status === 'ACTIVE'} label={r.status === 'ACTIVE' ? 'Active' : 'Suspendue'} />
                </td>
                <td>{planOf(r.plan).label}</td>
                <td>{SUBSCRIPTION_STATE_LABELS[r.subscriptionState]}</td>
                <td className="num">
                  <ExpiryState plan={r.plan} expiresAt={r.planExpiresAt} />
                </td>
                <td className="num">{r.locations.length}</td>
                <td className="num">{r.members}</td>
                <td className="num">{when(r.createdAt)}</td>
                <td className="num">{when(r.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="window-body">
          <fieldset className="group">
            <legend>Établissements de {selected.name}</legend>
            <div className="grid-wrap">
              <table className="grid compact">
                <thead>
                  <tr>
                    <th>Établissement</th>
                    <th>Exploitation</th>
                    <th>État</th>
                    <th>Pays</th>
                    <th>Devise</th>
                    <th>Créé le</th>
                    <th>Dernière activité</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.locations.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td>{MODE_LABELS[l.operatingMode]}</td>
                      <td>
                        <Dot ok={l.status === 'ACTIVE'} label={l.status === 'ACTIVE' ? 'Actif' : 'Archivé'} />
                      </td>
                      <td>{l.country}</td>
                      <td>{l.currency}</td>
                      <td className="num">{when(l.createdAt)}</td>
                      <td className="num">{when(l.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
        </div>
      )}
    </>
  );
}

// --- Utilisateurs -----------------------------------------------------------------

function UsersTab({ onError, onNotice }: TabProps) {
  const when = useWhen();
  const { lang } = useI18n();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PlatformUser[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows?.find((r) => r.id === selectedId) ?? null;

  const load = useCallback(() => api<PlatformUser[]>('GET', `/platform/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(setRows, onError), [q, onError]);
  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(action: 'suspend' | 'reactivate') {
    if (!selected) return;
    try {
      await api('POST', `/platform/users/${selected.id}/${action}`);
      onNotice(action === 'suspend' ? `Compte ${selected.displayName} suspendu.` : `Compte ${selected.displayName} réactivé.`);
      await load();
    } catch (err) {
      onError(err);
    }
  }

  return (
    <>
      <SearchBar placeholder="Nom ou adresse e-mail" onSearch={setQ}>
        <button className="btn" type="button" disabled={selected?.status !== 'ACTIVE' || selected.isPlatformAdmin} onClick={() => setStatus('suspend')}>
          <Icon name="power" />
          Suspendre
        </button>
        <button className="btn" type="button" disabled={selected?.status !== 'DISABLED'} onClick={() => setStatus('reactivate')}>
          <Icon name="power" />
          Réactiver
        </button>
      </SearchBar>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Nom</th>
              <th>E-mail</th>
              <th>Organisations</th>
              <th>État</th>
              <th>Dernière connexion</th>
              <th>Créé le</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  Aucun compte.
                </td>
              </tr>
            )}
            {rows?.map((u) => (
              <tr key={u.id} className="selectable" aria-selected={u.id === selectedId} onClick={() => setSelectedId(u.id)}>
                <td>
                  {u.displayName}
                  {u.isPlatformAdmin && <span className="tag">Back-office</span>}
                </td>
                <td>{u.email ?? '—'}</td>
                <td>
                  {u.memberships.map((m) => (
                    <span key={m.tenantId} className="platform-sub">
                      {m.tenantName} · {ROLE_LABELS[lang][m.role]}
                      {m.status !== 'ACTIVE' ? ' · désactivé' : ''}
                    </span>
                  ))}
                </td>
                <td>
                  <Dot ok={u.status === 'ACTIVE'} label={u.status === 'ACTIVE' ? 'Actif' : 'Suspendu'} />
                </td>
                <td className="num">{when(u.lastSeenAt)}</td>
                <td className="num">{when(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Installations et synchronisations -----------------------------------------------

function useList<T>(path: string, onError: (err: unknown) => void) {
  const [rows, setRows] = useState<T[] | null>(null);
  const load = useCallback(() => api<T[]>('GET', path).then(setRows, onError), [path, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, load };
}

function RefreshBar({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="platform-search">
      <button className="btn" onClick={onRefresh}>
        <Icon name="refresh" />
        Actualiser
      </button>
    </div>
  );
}

function DevicesTab({ onError }: TabProps) {
  const when = useWhen();
  const { rows, load } = useList<PlatformDevice>('/platform/devices', onError);
  return (
    <>
      <RefreshBar onRefresh={() => void load()} />
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Installation</th>
              <th>Type</th>
              <th>Organisation</th>
              <th>Établissement</th>
              <th>Version</th>
              <th>Dernier contact</th>
              <th>État</th>
              <th>Reliée le</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td className="empty" colSpan={8}>
                  Aucune installation.
                </td>
              </tr>
            )}
            {rows?.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.kind === 'LOCAL_SERVER' ? 'Serveur local' : d.kind}</td>
                <td>{d.tenantName ?? '—'}</td>
                <td>{d.locationName ?? '—'}</td>
                <td>{d.appVersion ?? '—'}</td>
                <td className="num">{when(d.lastSeenAt)}</td>
                <td>
                  <Dot ok={d.status === 'ACTIVE'} label={d.status === 'ACTIVE' ? 'Active' : 'Révoquée'} />
                </td>
                <td className="num">{when(d.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SyncTab({ onError }: TabProps) {
  const when = useWhen();
  const { rows, load } = useList<PlatformSyncState>('/platform/sync', onError);
  const count = (n: number | null) => (n === null ? '—' : String(n));
  return (
    <>
      <RefreshBar onRefresh={() => void load()} />
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Serveur local</th>
              <th>Organisation · établissement</th>
              <th>Dernier envoi</th>
              <th>Dernière réception</th>
              <th>En attente</th>
              <th>En échec</th>
              <th>Conflits</th>
              <th>Conflits (Cloud)</th>
              <th>Compteurs du</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td className="empty" colSpan={9}>
                  Aucun serveur local relié.
                </td>
              </tr>
            )}
            {rows?.map((s) => (
              <tr key={s.deviceId}>
                <td>
                  <Dot ok={s.status === 'ACTIVE'} label={s.name} />
                  {s.appVersion && <span className="platform-sub">Version {s.appVersion}</span>}
                </td>
                <td>{[s.tenantName, s.locationName].filter(Boolean).join(' · ') || '—'}</td>
                <td className="num">{when(s.lastPushAt)}</td>
                <td className="num">{when(s.lastPullAt)}</td>
                <td className="num">{count(s.pending)}</td>
                <td className="num">{count(s.failed)}</td>
                <td className="num">{count(s.conflicts)}</td>
                <td className="num">{s.cloudConflicts}</td>
                <td className="num">{when(s.reportedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Erreurs ------------------------------------------------------------------------

function ErrorsTab({ onError }: TabProps) {
  const when = useWhen();
  const [rows, setRows] = useState<ErrorLogEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const PAGE = 100;

  const load = useCallback(
    async (before?: number) => {
      try {
        const page = await api<ErrorLogEntry[]>('GET', `/platform/errors?limit=${PAGE}${before ? `&before=${before}` : ''}`);
        setRows((current) => (before && current ? [...current, ...page] : page));
        setMore(page.length === PAGE);
      } catch (err) {
        onError(err);
      }
    },
    [onError],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <RefreshBar onRefresh={() => void load()} />
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Date</th>
              <th>Route</th>
              <th>Code</th>
              <th>Message</th>
              <th>Organisation</th>
              <th>Requête</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td className="empty" colSpan={6}>
                  Aucune erreur enregistrée.
                </td>
              </tr>
            )}
            {rows?.map((e) => (
              <tr key={e.id}>
                <td className="num">{when(e.createdAt)}</td>
                <td>
                  {e.method} {e.route ?? '—'}
                </td>
                <td>
                  {e.status} {e.code}
                </td>
                <td className="platform-message">{e.message}</td>
                <td>{e.tenantName ?? '—'}</td>
                <td>
                  <code>{e.requestId ?? '—'}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && rows && rows.length > 0 && (
        <div className="platform-more">
          <button className="btn" onClick={() => void load(rows[rows.length - 1]!.createdAt)}>
            Plus anciennes
          </button>
        </div>
      )}
    </>
  );
}

// --- Statistiques ---------------------------------------------------------------------

function StatsTab({ onError }: TabProps) {
  const when = useWhen();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const load = useCallback(() => api<PlatformStats>('GET', '/platform/stats').then(setStats, onError), [onError]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!stats) return null;

  const kpis: [string, number, string][] = [
    ['Organisations', stats.tenants.total, `${stats.tenants.active} actives · ${stats.tenants.suspended} suspendues · ${stats.tenants.demo} démo`],
    ['Établissements actifs', stats.locations.active, `${stats.locations.hybrid} avec serveur local`],
    ['Comptes actifs', stats.users.active, ''],
    ['Serveurs locaux', stats.localServers.active, 'reliés et non révoqués'],
  ];
  return (
    <div className="window-body">
      <section className="kpi-strip" aria-label="Plateforme">
        {kpis.map(([label, value, context]) => (
          <div className="kpi" key={label}>
            <span className="kpi-label">{label}</span>
            <strong className="kpi-value">{value}</strong>
            <span className="kpi-context">{context}</span>
          </div>
        ))}
      </section>
      {stats.periods.map((p) => (
        <fieldset className="group platform-period" key={p.days}>
          <legend>
            {p.days} derniers jours · {p.activeLocations} établissement{p.activeLocations > 1 ? 's' : ''} avec des ventes
          </legend>
          <table className="grid compact">
            <thead>
              <tr>
                <th>Devise</th>
                <th>Commandes</th>
                <th>Chiffre d’affaires</th>
                <th>Encaissé</th>
              </tr>
            </thead>
            <tbody>
              {p.currencies.length === 0 && (
                <tr>
                  <td className="empty" colSpan={4}>
                    Aucune vente.
                  </td>
                </tr>
              )}
              {p.currencies.map((c) => (
                <tr key={c.currency}>
                  <td>{c.currency}</td>
                  <td className="num">{c.orders}</td>
                  <td className="num">{formatMoney(c.revenue, c.currency)}</td>
                  <td className="num">{formatMoney(c.collected, c.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      ))}
      <p className="muted">Organisations de démonstration exclues. Calculé le {when(stats.generatedAt)}.</p>
    </div>
  );
}
