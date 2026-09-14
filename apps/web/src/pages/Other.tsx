import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuditEntry, Me, PlatformTenant } from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { AUDIT_ACTION_LABELS, formatDateTime } from '../labels.ts';
import { Dialog, ErrorMessage, Icon, OkMessage, Window } from '../ui.tsx';
import { BackupsPanel } from './Backups.tsx';

interface TenantDetails {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  plan: string;
  isDemo: boolean;
  createdAt: number;
  locations: Me['locations'];
}

export function OrganizationPage({ me, onRenamed }: { me: Me; onRenamed: () => void }) {
  const { t, locale } = useI18n();
  const [tenant, setTenant] = useState<TenantDetails | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
            <button className="btn" onClick={load}>
              <Icon name="refresh" />
              {t('common.refresh')}
            </button>
          </>
        }
      >
        <ErrorMessage error={error} />
        {tenant?.isDemo && <div className="msg msg-warn">{t('org.demo')}</div>}
        <div className="form" style={{ maxWidth: 560 }}>
          <label>{t('auth.organizationName')}</label>
          <input readOnly value={tenant?.name ?? ''} />
          <label>{t('org.plan')}</label>
          <input readOnly value={tenant?.plan ?? ''} />
          <label>{t('org.status')}</label>
          <input readOnly value={tenant ? (tenant.status === 'ACTIVE' ? t('platform.active') : t('platform.suspended')) : ''} />
          <label>{t('org.createdAt')}</label>
          <input readOnly value={tenant ? formatDateTime(tenant.createdAt, locale) : ''} />
          <label>{t('org.locations')}</label>
          <input readOnly value={tenant ? String(tenant.locations.length) : ''} />
        </div>
        {me.permissions.includes('settings.manage') && <BackupsPanel />}
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

  return (
    <Window
      title={t('platform.title')}
      count={tenants ? String(tenants.length) : undefined}
      toolbar={
        <>
          <button className="btn" disabled={selected?.status !== 'ACTIVE'} onClick={() => setStatus('suspend')}>
            <Icon name="power" />
            {t('platform.suspend')}
          </button>
          <button className="btn" disabled={selected?.status !== 'SUSPENDED'} onClick={() => setStatus('reactivate')}>
            <Icon name="power" />
            {t('platform.reactivate')}
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
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t('team.name')}</th>
              <th>{t('platform.status')}</th>
              <th>{t('org.plan')}</th>
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
                <td>{x.plan}</td>
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
