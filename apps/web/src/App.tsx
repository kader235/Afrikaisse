import { useEffect, useState } from 'react';
import type { Me, SessionResponse } from '@afrikaisse/core';
import { ApiError, OFFLINE, api, refreshSession, setSession } from './api.ts';
import { useI18n } from './i18n.tsx';
import { ROLE_LABELS } from './labels.ts';
import { AccessScreen, LoginPage, RegisterPage } from './pages/Auth.tsx';
import { AccountPage, AuditPage, OrganizationPage, PlatformPage } from './pages/Other.tsx';
import { TeamPage } from './pages/Team.tsx';
import { FloorPage } from './pages/Floor.tsx';
import { LocationsPage } from './pages/Locations.tsx';
import { APP_VERSION, Brand, ErrorMessage, Icon, Preferences, usePreferences, type IconName } from './ui.tsx';

type State =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'anonymous'; screen: 'login' | 'register' }
  | { kind: 'session'; me: Me };

type Section = 'organization' | 'locations' | 'floor' | 'team' | 'audit' | 'account' | 'platform';

export function App() {
  usePreferences();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const boot = () => {
    setState({ kind: 'loading' });
    refreshSession().then(
      (s) => setState(s ? { kind: 'session', me: s.me } : { kind: 'anonymous', screen: 'login' }),
      (err) => setState(err instanceof ApiError && err.code === OFFLINE ? { kind: 'offline' } : { kind: 'anonymous', screen: 'login' }),
    );
  };
  useEffect(boot, []);

  const onSession = (s: SessionResponse) => {
    setSession(s);
    setState({ kind: 'session', me: s.me });
  };
  const logout = async () => {
    try {
      await api('POST', '/auth/logout');
    } finally {
      setSession(null);
      setState({ kind: 'anonymous', screen: 'login' });
    }
  };

  switch (state.kind) {
    case 'loading':
      return null;
    case 'offline':
      return <Offline onRetry={boot} />;
    case 'anonymous':
      return state.screen === 'login' ? (
        <LoginPage onSession={onSession} onRegister={() => setState({ kind: 'anonymous', screen: 'register' })} />
      ) : (
        <RegisterPage onSession={onSession} onLogin={() => setState({ kind: 'anonymous', screen: 'login' })} />
      );
    case 'session':
      return <Shell me={state.me} onMe={(me) => setState({ kind: 'session', me })} onSession={onSession} onLogout={logout} />;
  }
}

function Offline({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <AccessScreen
      title={t('offline.title')}
      footer={
        <button className="btn btn-primary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      }
    >
      <p>{t('offline.body')}</p>
    </AccessScreen>
  );
}

interface Health {
  profile: 'cloud' | 'local';
  database: 'postgres' | 'sqlite';
  version: string;
}

/** Barre d'état : uniquement des informations réelles, rafraîchies toutes les 30 s. */
function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let alive = true;
    const ping = () =>
      api<Health>('GET', '/health').then(
        (h) => alive && (setHealth(h), setOnline(true)),
        () => alive && setOnline(false),
      );
    void ping();
    const id = window.setInterval(ping, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return { health, online };
}

function Shell({ me, onMe, onSession, onLogout }: { me: Me; onMe: (me: Me) => void; onSession: (s: SessionResponse) => void; onLogout: () => void }) {
  const { t, lang } = useI18n();
  const [error, setError] = useState<unknown>(null);
  const { health, online } = useHealth();
  const can = (p: Me['permissions'][number]) => me.permissions.includes(p);

  const sections: { id: Section; label: string; icon: IconName; visible: boolean }[] = [
    { id: 'organization', label: t('nav.organization'), icon: 'building', visible: can('tenant.read') },
    { id: 'locations', label: t('nav.locations'), icon: 'store', visible: can('location.read') },
    { id: 'floor', label: t('nav.floor'), icon: 'layout', visible: can('tables.read') },
    { id: 'team', label: t('nav.team'), icon: 'team', visible: can('users.read') },
    { id: 'audit', label: t('nav.audit'), icon: 'journal', visible: can('audit.read') },
    { id: 'account', label: t('nav.account'), icon: 'user', visible: true },
    { id: 'platform', label: t('nav.platform'), icon: 'server', visible: me.user.isPlatformAdmin },
  ];
  const visible = sections.filter((s) => s.visible);
  // Le personnel de salle ouvre directement le plan ; la direction, l'organisation.
  const [section, setSection] = useState<Section>(() => (can('tables.read') && !can('tenant.update') ? 'floor' : visible[0]!.id));
  const current = visible.some((s) => s.id === section) ? section : visible[0]!.id;

  async function switchTo(tenantId: string) {
    setError(null);
    try {
      onSession(await api<SessionResponse>('POST', '/auth/switch-tenant', { tenantId }));
    } catch (err) {
      setError(err);
    }
  }
  const reloadMe = () => api<Me>('GET', '/auth/me').then(onMe, setError);

  // Pas d'organisation utilisable : choix ou explication, jamais un écran vide.
  if (me.tenantAccess !== 'OK' && !(me.user.isPlatformAdmin && me.memberships.length === 0)) {
    const others = me.memberships.filter((m) => m.tenantId !== me.tenant?.id);
    return (
      <AccessScreen
        title={t('choose.title')}
        footer={
          <button className="btn" onClick={onLogout}>
            {t('common.logout')}
          </button>
        }
      >
        {me.tenantAccess !== 'NONE' && (
          <div className="msg msg-warn">
            <strong>{me.tenant?.name}</strong> — {t(`blocked.${me.tenantAccess}` as 'blocked.SUSPENDED')}
          </div>
        )}
        <ErrorMessage error={error} />
        <div className="choice-list">
          {others.map((m) => (
            <button key={m.membershipId} className="btn" onClick={() => switchTo(m.tenantId)}>
              <span>{m.tenantName}</span>
              <span className="muted">{ROLE_LABELS[lang][m.role]}</span>
            </button>
          ))}
        </div>
      </AccessScreen>
    );
  }

  return (
    <div className="app">
      <header className="appbar">
        <Brand />
        <div className="org">
          {me.tenant && me.memberships.length > 1 ? (
            <select aria-label={t('shell.switchOrg')} value={me.tenant.id} onChange={(e) => switchTo(e.target.value)}>
              {me.memberships.map((m) => (
                <option key={m.membershipId} value={m.tenantId}>
                  {m.tenantName}
                </option>
              ))}
            </select>
          ) : (
            <span>{me.tenant?.name}</span>
          )}
          {me.locations.length === 1 && (
            <>
              <span className="sep">|</span>
              <span>{me.locations[0]!.name}</span>
            </>
          )}
        </div>
        <div className="user">
          <span>
            {me.user.displayName}
            {me.role && ` · ${ROLE_LABELS[lang][me.role]}`}
          </span>
          <button className="btn" onClick={onLogout}>
            <Icon name="logout" />
            {t('common.logout')}
          </button>
        </div>
      </header>

      <nav className="menubar">
        {visible.map((s) => (
          <button key={s.id} aria-current={current === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
            <Icon name={s.icon} />
            {s.label}
          </button>
        ))}
      </nav>

      <main className="workspace">
        {!!error && <ErrorMessage error={error} />}
        {current === 'organization' && <OrganizationPage me={me} onRenamed={reloadMe} />}
        {current === 'locations' && <LocationsPage me={me} onChanged={reloadMe} />}
        {current === 'floor' && <FloorPage me={me} />}
        {current === 'team' && <TeamPage me={me} />}
        {current === 'audit' && <AuditPage />}
        {current === 'account' && <AccountPage me={me} />}
        {current === 'platform' && <PlatformPage />}
      </main>

      <footer className="statusbar">
        <span>
          <span className={online ? 'dot dot-ok' : 'dot dot-off'} />
          {online ? t('status.connected') : t('status.offline')}
        </span>
        {health && (
          <span>
            {health.profile === 'cloud' ? t('status.cloud') : t('status.local')} · {health.database === 'postgres' ? 'PostgreSQL' : 'SQLite'}
          </span>
        )}
        {me.tenant && <span>{me.tenant.name}</span>}
        <span>
          {t('status.version')} {health?.version ?? APP_VERSION}
        </span>
        <span className="push">
          <Preferences />
        </span>
      </footer>
    </div>
  );
}
