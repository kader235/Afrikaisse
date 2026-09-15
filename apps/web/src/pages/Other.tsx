import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  GRACE_DAYS,
  LIMITED_RESOURCES,
  PLANS,
  PLAN_CODES,
  RESOURCE_LABELS,
  SUBSCRIPTION_STATE_LABELS,
  extendExpiry,
  planOf,
  subscriptionState,
  type AuditEntry,
  type DemoTenant,
  type Me,
  type PlanCode,
  type PlatformTenant,
  type Subscription,
} from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { AUDIT_ACTION_LABELS, ROLE_LABELS, formatDateTime } from '../labels.ts';
import { Dialog, ErrorMessage, Icon, OkMessage, Window } from '../ui.tsx';
import { BackupsPanel } from './Backups.tsx';
import { SyncPanel } from './Sync.tsx';

interface TenantDetails {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  plan: string;
  isDemo: boolean;
  createdAt: number;
  subscription: Subscription;
  locations: Me['locations'];
}

export function OrganizationPage({ me, onRenamed, onOpenSetup }: { me: Me; onRenamed: () => void; onOpenSetup?: () => void }) {
  const { t, locale } = useI18n();
  const [tenant, setTenant] = useState<TenantDetails | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Les abonnements ne concernent que le Cloud : un serveur local ne contrôle ni n'affiche aucune offre.
  const [isCloud, setIsCloud] = useState(false);
  useEffect(() => {
    api<{ profile: string }>('GET', '/health').then((h) => setIsCloud(h.profile === 'cloud'), () => undefined);
  }, []);

  const load = useCallback(() => api<TenantDetails>('GET', '/tenant').then(setTenant, setError), []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Window
        title={t('org.title')}
        toolbar={
          <>
            {me.permissions.includes('tenant.update') && (
              <button className="btn" disabled={!tenant} onClick={() => setRenaming(true)}>
                <Icon name="edit" />
                {t('org.rename')}
              </button>
            )}
            {onOpenSetup && (
              <button className="btn" onClick={onOpenSetup}>
                <Icon name="list" />
                Assistant de mise en route
              </button>
            )}
            <button className="btn" onClick={load}>
              <Icon name="refresh" />
              {t('common.refresh')}
            </button>
          </>
        }
      >
        <ErrorMessage error={error} />
        {tenant?.isDemo && <div className="msg msg-warn">{t('org.demo')}</div>}
        <div className="org-layout">
        <fieldset className="group">
        <legend>Organisation</legend>
        <div className="form">
          <label>{t('auth.organizationName')}</label>
          <input readOnly value={tenant?.name ?? ''} />
          <label>{t('org.status')}</label>
          <input readOnly value={tenant ? (tenant.status === 'ACTIVE' ? t('platform.active') : t('platform.suspended')) : ''} />
          <label>{t('org.createdAt')}</label>
          <input readOnly value={tenant ? formatDateTime(tenant.createdAt, locale) : ''} />
          <label>{t('org.locations')}</label>
          <input readOnly value={tenant ? String(tenant.locations.length) : ''} />
        </div>
        </fieldset>
        <div className="org-side">
        {tenant && isCloud && <SubscriptionPanel subscription={tenant.subscription} />}
        {me.permissions.includes('settings.manage') && <SyncPanel />}
        {me.permissions.includes('settings.manage') && <BackupsPanel />}
        </div>
        </div>
      </Window>

      {renaming && tenant && (
        <RenameDialog
          current={tenant.name}
          onClose={() => setRenaming(false)}
          onSaved={(next) => {
            setTenant(next);
            setRenaming(false);
            onRenamed();
          }}
        />
      )}
    </>
  );
}

function RenameDialog({ current, onSaved, onClose }: { current: string; onSaved: (t: TenantDetails) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(current);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      onSaved(await api<TenantDetails>('PATCH', '/tenant', { name }));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={t('org.renameTitle')}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary">{t('common.save')}</button>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="o-name">{t('auth.organizationName')}</label>
            <input id="o-name" required minLength={2} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}

export function AuditPage() {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const PAGE = 50;

  const load = useCallback(async (before?: number) => {
    setError(null);
    try {
      const page = await api<AuditEntry[]>('GET', `/audit?limit=${PAGE}${before ? `&before=${before}` : ''}`);
      setEntries((prev) => (before ? [...(prev ?? []), ...page] : page));
      setDone(page.length < PAGE);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Window
      title={t('audit.title')}
      count={entries ? String(entries.length) : undefined}
      toolbar={
        <>
          <button className="btn" onClick={() => load()}>
            <Icon name="refresh" />
            {t('common.refresh')}
          </button>
          <button className="btn" disabled={!entries?.length || done} onClick={() => entries && load(entries[entries.length - 1]!.createdAt)}>
            <Icon name="more" />
            {t('audit.more')}
          </button>
        </>
      }
      bodyless
    >
      {!!error && (
        <div className="window-body" style={{ paddingBottom: 0 }}>
          <ErrorMessage error={error} />
        </div>
      )}
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t('audit.date')}</th>
              <th>{t('audit.action')}</th>
              <th>{t('audit.user')}</th>
              <th>{t('audit.detail')}</th>
              <th>{t('audit.ip')}</th>
            </tr>
          </thead>
          <tbody>
            {entries?.length === 0 && (
              <tr>
                <td className="empty" colSpan={5}>
                  {t('audit.empty')}
                </td>
              </tr>
            )}
            {entries?.map((e) => (
              <tr key={e.id}>
                <td className="num">{formatDateTime(e.createdAt, locale)}</td>
                <td>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</td>
                <td>{e.actorName ?? t('audit.system')}</td>
                <td className="muted">{e.subject ?? ''}</td>
                <td className="num muted">{e.ip ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Window>
  );
}

export function AccountPage({ me }: { me: Me }) {
  const { t } = useI18n();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    try {
      await api('POST', '/auth/password', { currentPassword, newPassword });
      setOk(true);
      setCurrent('');
      setNext('');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Window title={t('account.title')}>
      <div style={{ maxWidth: 560 }}>
        <div className="form">
          <label>{t('auth.ownerName')}</label>
          <input readOnly value={me.user.displayName} />
          <label>{t('auth.email')}</label>
          <input readOnly value={me.user.email ?? ''} />
        </div>
        <form onSubmit={submit} style={{ marginTop: 16 }}>
          <fieldset className="group">
            <legend>{t('account.changePassword')}</legend>
            <ErrorMessage error={error} />
            {ok && <OkMessage>{t('account.passwordChanged')}</OkMessage>}
            <div className="form">
              <label htmlFor="a-current">{t('account.currentPassword')}</label>
              <input id="a-current" type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
              <label htmlFor="a-new">{t('account.newPassword')}</label>
              <input id="a-new" type="password" required minLength={10} autoComplete="new-password" value={newPassword} onChange={(e) => setNext(e.target.value)} />
              <span className="hint">{t('auth.passwordHint')}</span>
              <span />
              <div>
                <button className="btn btn-primary">{t('account.changePassword')}</button>
              </div>
            </div>
          </fieldset>
        </form>
      </div>
    </Window>
  );
}

export function PlatformPage() {
  const { t, locale } = useI18n();
  const [tenants, setTenants] = useState<PlatformTenant[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [demo, setDemo] = useState<DemoTenant | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = tenants?.find((x) => x.id === selectedId) ?? null;

  const load = useCallback(() => api<PlatformTenant[]>('GET', '/platform/tenants').then(setTenants, setError), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(action: 'suspend' | 'reactivate') {
    if (!selected) return;
    setError(null);
    try {
      await api('POST', `/platform/tenants/${selected.id}/${action}`);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  async function createDemo() {
    setCreating(true);
    setError(null);
    try {
      setDemo(await api<DemoTenant>('POST', '/platform/demo-tenants', {}));
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Window
      title={t('platform.title')}
      count={tenants ? String(tenants.length) : undefined}
      toolbar={
        <>
          <button className="btn" disabled={!selected} onClick={() => setEditing(true)}>
            <Icon name="key" />
            Abonnement…
          </button>
          <button className="btn" disabled={selected?.status !== 'ACTIVE'} onClick={() => setStatus('suspend')}>
            <Icon name="power" />
            {t('platform.suspend')}
          </button>
          <button className="btn" disabled={selected?.status !== 'SUSPENDED'} onClick={() => setStatus('reactivate')}>
            <Icon name="power" />
            {t('platform.reactivate')}
          </button>
          <button className="btn" disabled={creating} onClick={createDemo}>
            <Icon name="add" />
            {creating ? 'Démonstration en cours…' : 'Démonstration'}
          </button>
          <span className="sep" />
          <button className="btn" onClick={load}>
            <Icon name="refresh" />
            {t('common.refresh')}
          </button>
        </>
      }
      bodyless
    >
      {!!error && (
        <div className="window-body" style={{ paddingBottom: 0 }}>
          <ErrorMessage error={error} />
        </div>
      )}
      {demo && (
        <Dialog
          wide
          title={demo.organizationName}
          onClose={() => setDemo(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setDemo(null)}>
              Fermer
            </button>
          }
        >
          <div className="dialog-body">
            <div className="msg msg-warn">Identifiants affichés une seule fois.</div>
            <div className="grid-wrap">
              <table className="grid compact">
                <thead>
                  <tr>
                    <th>Rôle</th>
                    <th>Nom</th>
                    <th>E-mail</th>
                    <th>Mot de passe</th>
                  </tr>
                </thead>
                <tbody>
                  {[demo.owner, ...demo.staff].map((c) => (
                    <tr key={c.email}>
                      <td>{ROLE_LABELS.fr[c.role]}</td>
                      <td>{c.displayName}</td>
                      <td>{c.email}</td>
                      <td className="num">{c.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Dialog>
      )}
      {editing && selected && (
        <SubscriptionDialog
          tenant={selected}
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
              <th>{t('team.name')}</th>
              <th>{t('platform.status')}</th>
              <th>{t('org.plan')}</th>
              <th>Échéance</th>
              <th>{t('platform.members')}</th>
              <th>{t('org.locations')}</th>
              <th>{t('platform.createdAt')}</th>
            </tr>
          </thead>
          <tbody>
            {tenants?.map((x) => (
              <tr key={x.id} className="selectable" aria-selected={x.id === selectedId} onClick={() => setSelectedId(x.id)}>
                <td>
                  {x.name}
                  {x.isDemo && <span className="tag">{t('org.demo')}</span>}
                </td>
                <td>
                  <span className={x.status === 'ACTIVE' ? 'state state-ok' : 'state state-off'}>
                    <span className={x.status === 'ACTIVE' ? 'dot dot-ok' : 'dot dot-off'} />
                    {x.status === 'ACTIVE' ? t('platform.active') : t('platform.suspended')}
                  </span>
                </td>
                <td>{planOf(x.plan).label}</td>
                <td className="num">
                  <ExpiryState plan={x.plan} expiresAt={x.planExpiresAt} />
                </td>
                <td className="num">{x.members}</td>
                <td className="num">{x.locations}</td>
                <td className="num">{formatDateTime(x.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Window>
  );
}

// --- Abonnement (phase 17) ------------------------------------------------------

function priceLabel(price: number | null) {
  if (price === null) return 'sur devis';
  if (price === 0) return 'gratuit';
  return `${price.toLocaleString('fr-FR')} FCFA / mois`;
}

function expiryLabel(expiresAt: number | null) {
  return expiresAt === null ? 'Sans échéance' : new Date(expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const days = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;

function daysLabel(daysLeft: number) {
  if (daysLeft > 0) return `encore ${days(daysLeft)}`;
  if (daysLeft === 0) return "échue aujourd'hui";
  return `échue depuis ${days(-daysLeft)}`;
}

function ExpiryState({ plan, expiresAt }: { plan: string; expiresAt: number | null }) {
  if (expiresAt === null) return <span className="muted">Sans échéance</span>;
  const { state } = subscriptionState(plan, expiresAt, Date.now());
  const tone = state === 'EXPIRED' ? 'state state-off' : state === 'GRACE' ? 'state state-warn' : 'state';
  return <span className={tone}>{new Date(expiresAt).toLocaleDateString('fr-FR')}</span>;
}

function SubscriptionPanel({ subscription: s }: { subscription: Subscription }) {
  const tone = s.state === 'EXPIRED' ? 'st st-cancelled' : s.state === 'GRACE' ? 'st st-pending' : 'st st-ready';
  return (
    <fieldset className="group">
      <legend>Abonnement AfriKaisse</legend>
      <dl className="kv">
        <dt>Offre</dt>
        <dd>
          <strong>{s.label}</strong> · {priceLabel(s.monthlyPrice)}
        </dd>
        <dt>État</dt>
        <dd>
          <span className={tone}>{SUBSCRIPTION_STATE_LABELS[s.state]}</span>
        </dd>
        <dt>Échéance</dt>
        <dd>
          {expiryLabel(s.expiresAt)}
          {s.daysLeft !== null && ` · ${daysLabel(s.daysLeft)}`}
        </dd>
      </dl>
      <table className="grid usage-table">
        <thead>
          <tr>
            <th>Utilisation</th>
            <th className="num">Utilisé</th>
            <th className="num">Inclus</th>
            <th aria-label="Jauge" />
          </tr>
        </thead>
        <tbody>
          {LIMITED_RESOURCES.map((r) => {
            const limit = s.limits[r];
            const used = s.usage[r];
            return (
              <tr key={r}>
                <td>{RESOURCE_LABELS[r]}</td>
                <td className="num">{used}</td>
                <td className="num">{limit ?? 'Illimité'}</td>
                <td>
                  {limit !== null && (
                    <span className="meter" role="img" aria-label={`${used} sur ${limit}`}>
                      <span className={used >= limit ? 'full' : undefined} style={{ inlineSize: `${Math.min(100, Math.round((used / Math.max(limit, 1)) * 100))}%` }} />
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table className="grid offers-table">
        <thead>
          <tr>
            <th>Offre</th>
            <th className="num">Prix</th>
            <th className="num">Établissements</th>
            <th className="num">Membres</th>
            <th className="num">Serveurs locaux</th>
          </tr>
        </thead>
        <tbody>
          {PLAN_CODES.filter((code) => code !== 'TRIAL').map((code) => {
            const p = PLANS[code];
            return (
              <tr key={code} aria-current={code === s.plan ? 'true' : undefined}>
                <td>
                  {p.label}
                  {code === s.plan && <span className="tag">Votre offre</span>}
                  <div className="muted">{p.summary}</div>
                </td>
                <td className="num">{priceLabel(p.monthlyPrice)}</td>
                <td className="num">{p.limits.locations ?? 'Illimité'}</td>
                <td className="num">{p.limits.members ?? 'Illimité'}</td>
                <td className="num">{p.limits.localServers ?? 'Illimité'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </fieldset>
  );
}

function SubscriptionDialog({ tenant, onClose, onSaved }: { tenant: PlatformTenant; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState<PlanCode>((PLAN_CODES as readonly string[]).includes(tenant.plan) ? (tenant.plan as PlanCode) : 'STARTER');
  const [months, setMonths] = useState(1);
  const [unlimited, setUnlimited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const next = unlimited ? null : months > 0 ? extendExpiry(tenant.planExpiresAt, months, Date.now()) : tenant.planExpiresAt;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/platform/tenants/${tenant.id}/subscription`, { plan, months: unlimited ? 0 : months, unlimited });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={`Abonnement — ${tenant.name}`}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy}>
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
            <label htmlFor="s-plan">Offre</label>
            <select id="s-plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
              {PLAN_CODES.map((code) => (
                <option key={code} value={code}>
                  {PLANS[code].label} — {priceLabel(PLANS[code].monthlyPrice)}
                </option>
              ))}
            </select>
            <label htmlFor="s-months">Mois réglés</label>
            <select id="s-months" value={months} disabled={unlimited} onChange={(e) => setMonths(Number(e.target.value))}>
              {[0, 1, 3, 6, 12, 24].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "Aucun (changer d'offre seulement)" : `${m} mois`}
                </option>
              ))}
            </select>
            <label htmlFor="s-unlimited">Sans échéance</label>
            <input id="s-unlimited" type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
            <label htmlFor="s-current">Échéance actuelle</label>
            <input id="s-current" readOnly value={expiryLabel(tenant.planExpiresAt)} />
            <label htmlFor="s-next">Nouvelle échéance</label>
            <input id="s-next" readOnly value={expiryLabel(next)} />
          </div>
        </div>
      </Dialog>
    </form>
  );
}
