import { LogoAfrikaisse } from './logo.tsx';
import { PhotoCredits } from './pages/PhotoCredits.tsx';
import { useEffect, useState } from 'react';
import { GRACE_DAYS, subscriptionState, type Me, type Role, type SessionResponse } from '@afrikaisse/core';
import { ApiError, OFFLINE, api, refreshSession, setSession } from './api.ts';
import { useI18n } from './i18n.tsx';
import { ROLE_LABELS } from './labels.ts';
import { AccessScreen, LoginPage, RegisterPage } from './pages/Auth.tsx';
import { AccountPage, AuditPage, OrganizationPage, PlatformPage } from './pages/Other.tsx';
import { TeamPage } from './pages/Team.tsx';
import { FloorPage } from './pages/Floor.tsx';
import { LocationsPage } from './pages/Locations.tsx';
import { MenuPage } from './pages/Menu.tsx';
import { OrdersPage } from './pages/Orders.tsx';
import { PosPage } from './pages/Pos.tsx';
import { KitchenPage } from './pages/Kitchen.tsx';
import { ReportsPage } from './pages/Reports.tsx';
import { StockPage } from './pages/Stock.tsx';
import { useActivityFeed } from './activity.ts';
import { ServerPage } from './pages/Server.tsx';
import { isNativeApp, readServer, saveServer } from './platform.ts';
import type { ServerSwitch } from './pages/Auth.tsx';
import { APP_VERSION, ErrorMessage, Icon, Preferences, usePreferences, type IconName } from './ui.tsx';

type State =
  | { kind: 'loading' }
  | { kind: 'server' }
  | { kind: 'offline' }
  | { kind: 'anonymous'; screen: 'login' | 'register' }
  | { kind: 'session'; me: Me };

type Section = 'orders' | 'pos' | 'kitchen' | 'reports' | 'stock' | 'organization' | 'locations' | 'floor' | 'menu' | 'team' | 'audit' | 'account' | 'platform';

export function App() {
  usePreferences();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const boot = () => {
    // Tablette sans serveur choisi : on ne peut rien appeler avant de savoir où.
    if (isNativeApp() && !readServer()) {
      setState({ kind: 'server' });
      return;
    }
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

  const server: ServerSwitch | undefined = isNativeApp()
    ? { label: (readServer()?.url ?? '').replace(/^https?:\/\//, ''), onChange: () => setState({ kind: 'server' }) }
    : undefined;

  switch (state.kind) {
    case 'loading':
      return null;
    case 'server':
      return (
        <ServerPage
          current={readServer()}
          onSaved={(choice) => {
            const changed = readServer()?.url !== choice.url;
            saveServer(choice);
            // Un jeton émis par un autre serveur n'y vaut rien : on repart de zéro.
            if (changed) setSession(null);
            boot();
          }}
        />
      );
    case 'offline':
      return <Offline onRetry={boot} server={server} />;
    case 'anonymous':
      return state.screen === 'login' ? (
        <LoginPage server={server} onSession={onSession} onRegister={() => setState({ kind: 'anonymous', screen: 'register' })} />
      ) : (
        <RegisterPage server={server} onSession={onSession} onLogin={() => setState({ kind: 'anonymous', screen: 'login' })} />
      );
    case 'session':
      return <Shell me={state.me} onMe={(me) => setState({ kind: 'session', me })} onSession={onSession} onLogout={logout} />;
  }
}

function Offline({ onRetry, server }: { onRetry: () => void; server?: ServerSwitch }) {
  const { t } = useI18n();
  return (
    <AccessScreen
      server={server}
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
  lanUrls?: string[];
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
  // Un seul flux d'activité pour toute l'application : pastille et signal sonore sur tous les écrans.
  // Le signal des commandes QR et des appels de table concerne la salle, pas la cuisine.
  const feed = useActivityFeed(me.locations[0]?.id ?? null, can('orders.read') && me.tenantAccess === 'OK', can('orders.create'));
  const waiting = feed.orders.filter((o) => o.status === 'PENDING').length + feed.requests.length;

  const sections: NavItem[] = [
    { id: 'reports', label: t('nav.reports'), icon: 'chart', visible: can('reports.read'), group: 'service' },
    { id: 'orders', label: t('nav.orders'), icon: 'journal', visible: can('orders.read'), badge: waiting, group: 'service' },
    { id: 'pos', label: t('nav.pos'), icon: 'cash', visible: can('pos.use') || can('payments.collect'), group: 'service' },
    { id: 'floor', label: t('nav.floor'), icon: 'layout', visible: can('tables.read'), group: 'service' },
    { id: 'kitchen', label: t('nav.kitchen'), icon: 'kitchen', visible: can('kitchen.use') || can('bar.use'), group: 'service' },
    { id: 'menu', label: t('nav.menu'), icon: 'menu', visible: can('menu.read'), group: 'service' },
    { id: 'stock', label: t('nav.stock'), icon: 'box', visible: can('inventory.read'), group: 'service' },
    { id: 'organization', label: t('nav.organization'), icon: 'building', visible: can('tenant.read'), group: 'admin' },
    { id: 'locations', label: t('nav.locations'), icon: 'store', visible: can('location.read'), group: 'admin' },
    { id: 'team', label: t('nav.team'), icon: 'team', visible: can('users.read'), group: 'admin' },
    { id: 'audit', label: t('nav.audit'), icon: 'journal', visible: can('audit.read'), group: 'admin' },
    { id: 'platform', label: t('nav.platform'), icon: 'server', visible: me.user.isPlatformAdmin, group: 'admin' },
    { id: 'account', label: t('nav.account'), icon: 'user', visible: true, group: 'account' },
  ];
  const visible = sections.filter((s) => s.visible);
  // Quatre onglets au plus, choisis selon le métier ; tout le reste est rangé dans « Plus ».
  const wanted = TAB_PRIORITY[me.role ?? 'OWNER'];
  const tabs = wanted.map((id) => visible.find((s) => s.id === id)).filter((s): s is NavItem => !!s).slice(0, 4);
  if (tabs.length === 0) tabs.push(visible[0]!);
  const others = visible.filter((s) => !tabs.includes(s));
  const [moreOpen, setMoreOpen] = useState(false);
  const [section, setSection] = useState<Section>(() => tabs[0]!.id);
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
      <header className="topbar">
        <div className="topbar-brand">
          <LogoAfrikaisse />
          <div>
            <strong>{me.tenant?.name ?? 'AfriKaisse'}</strong>
            {me.locations.length === 1 && <span>{me.locations[0]!.name}</span>}
          </div>
        </div>
        <nav className="tabs" aria-label="Navigation">
          {tabs.map((s) => (
            <button key={s.id} className="tab" aria-current={current === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
              <Icon name={s.icon} />
              <span className="tab-label">{s.label}</span>
              {!!s.badge && <span className="badge-count">{s.badge}</span>}
            </button>
          ))}
          {others.length > 0 && (
            <button className="tab" aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={others.some((s) => s.id === current) ? 'page' : undefined} onClick={() => setMoreOpen(true)}>
              <Icon name="more" />
              <span className="tab-label">{others.some((s) => s.id === current) ? others.find((s) => s.id === current)!.label : 'Plus'}</span>
              {others.some((s) => !!s.badge) && <span className="badge-count">{others.reduce((n, s) => n + (s.badge ?? 0), 0)}</span>}
            </button>
          )}
        </nav>
        <button className="topbar-user" onClick={() => setMoreOpen(true)} aria-label="Mon compte et réglages">
          <span className={online ? 'dot dot-ok' : 'dot dot-off'} aria-hidden="true" />
          <span className="topbar-name">
            <strong>{me.user.displayName}</strong>
            <span>{me.role ? ROLE_LABELS[lang][me.role] : ''}</span>
          </span>
          <span className="avatar">{initials(me.user.displayName)}</span>
        </button>
      </header>

      <main className="workspace">
        {can('tenant.read') && <SubscriptionBanner me={me} onOpen={() => setSection('organization')} />}
        {!!error && <ErrorMessage error={error} />}
        {current === 'orders' && <OrdersPage me={me} feed={feed} />}
        {current === 'pos' && <PosPage me={me} />}
        {current === 'kitchen' && <KitchenPage me={me} feed={feed} />}
        {current === 'reports' && <ReportsPage />}
        {current === 'stock' && <StockPage me={me} />}
        {current === 'organization' && <OrganizationPage me={me} onRenamed={reloadMe} />}
        {current === 'locations' && <LocationsPage me={me} onChanged={reloadMe} />}
        {current === 'floor' && <FloorPage me={me} feed={feed} />}
        {current === 'menu' && <MenuPage me={me} />}
        {current === 'team' && <TeamPage me={me} />}
        {current === 'audit' && <AuditPage />}
        {current === 'account' && <AccountPage me={me} />}
        {current === 'platform' && <PlatformPage />}
      </main>

      {moreOpen && (
        <MoreSheet
          me={me}
          items={others}
          current={current}
          health={health}
          online={online}
          onSelect={(id) => {
            setSection(id);
            setMoreOpen(false);
          }}
          onSwitch={switchTo}
          onLogout={onLogout}
          onClose={() => setMoreOpen(false)}
        />
      )}
    </div>
  );
}

type NavItem = { id: Section; label: string; icon: IconName; visible: boolean; badge?: number; group: 'service' | 'admin' | 'account' };

/** Onglets affichés d'abord, par métier : chacun ouvre son outil. */
const TAB_PRIORITY: Record<Role, Section[]> = {
  OWNER: ['reports', 'orders', 'pos', 'menu'],
  ADMIN: ['reports', 'orders', 'pos', 'menu'],
  MANAGER: ['orders', 'pos', 'floor', 'menu'],
  CASHIER: ['pos', 'orders'],
  WAITER: ['floor', 'orders'],
  KITCHEN: ['kitchen'],
  BAR: ['kitchen'],
  STOCK_MANAGER: ['stock', 'menu'],
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

const GROUP_TITLES: Record<NavItem['group'], string> = { service: 'Service', admin: 'Administration', account: 'Compte' };

/** « Plus » : tout ce qui n'a pas sa place dans les onglets, en grandes tuiles, avec les réglages et la déconnexion. */
function MoreSheet({
  me,
  items,
  current,
  health,
  online,
  onSelect,
  onSwitch,
  onLogout,
  onClose,
}: {
  me: Me;
  items: NavItem[];
  current: Section;
  health: Health | null;
  online: boolean;
  onSelect: (id: Section) => void;
  onSwitch: (tenantId: string) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [credits, setCredits] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !credits && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, credits]);
  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label="Plus" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="avatar avatar-lg">{initials(me.user.displayName)}</span>
          <div className="sheet-who">
            <strong>{me.user.displayName}</strong>
            <span>
              {me.role ? ROLE_LABELS[lang][me.role] : ''}
              {me.tenant ? ` · ${me.tenant.name}` : ''}
            </span>
          </div>
          <button className="icon-btn" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        {me.tenant && me.memberships.length > 1 && (
          <label className="sheet-field">
            <span>{t('shell.switchOrg')}</span>
            <select value={me.tenant.id} onChange={(e) => onSwitch(e.target.value)}>
              {me.memberships.map((m) => (
                <option key={m.membershipId} value={m.tenantId}>
                  {m.tenantName}
                </option>
              ))}
            </select>
          </label>
        )}
        {(['service', 'admin', 'account'] as const).map((group) => {
          const list = items.filter((i) => i.group === group);
          if (list.length === 0) return null;
          return (
            <section key={group} className="sheet-group">
              <h2>{GROUP_TITLES[group]}</h2>
              <div className="sheet-tiles">
                {list.map((i) => (
                  <button key={i.id} className="sheet-tile" aria-current={current === i.id ? 'page' : undefined} onClick={() => onSelect(i.id)}>
                    <Icon name={i.icon} />
                    <span>{i.label}</span>
                    {!!i.badge && <span className="badge-count">{i.badge}</span>}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        <section className="sheet-group">
          <h2>Affichage</h2>
          <div className="sheet-prefs">
            <Preferences />
          </div>
        </section>
        <div className="sheet-info">
          <span>
            <span className={online ? 'dot dot-ok' : 'dot dot-off'} />
            {online ? t('status.connected') : t('status.offline')}
            {health && ` · ${health.profile === 'cloud' ? t('status.cloud') : t('status.local')}`}
          </span>
          {health?.profile === 'local' && !!health.lanUrls?.length && <span>Adresse pour les tablettes : {health.lanUrls.map((u) => u.replace(/^http:\/\//, '')).join(' · ')}</span>}
          <span>
            GLOBALTECH BUSINESS TD · {t('status.version')} {health?.version ?? APP_VERSION}
          </span>
          <button type="button" className="link sheet-credits" onClick={() => setCredits(true)}>
            Crédits des photos
          </button>
        </div>
        <button className="btn sheet-logout" onClick={onLogout}>
          <Icon name="logout" />
          {t('common.logout')}
        </button>
        {credits && <PhotoCredits onClose={() => setCredits(false)} />}
      </aside>
    </div>
  );
}

const nDays = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;

/** Rappel d'échéance : discret sept jours avant, franc une fois échu. Jamais bloquant. */
function SubscriptionBanner({ me, onOpen }: { me: Me; onOpen: () => void }) {
  const tenant = me.tenant;
  if (!tenant || tenant.planExpiresAt === null) return null;
  const { state, daysLeft } = subscriptionState(tenant.plan, tenant.planExpiresAt, Date.now());
  if (daysLeft === null) return null;
  let text: string | null = null;
  if (state === 'EXPIRED') text = `Abonnement échu depuis ${nDays(-daysLeft)} : le service continue, mais l'ajout d'établissements, de membres et de serveurs locaux est suspendu.`;
  else if (state === 'GRACE') text = `Abonnement échu : encore ${nDays(Math.max(1, GRACE_DAYS + daysLeft))} avant la suspension des ajouts. Le service n'est pas concerné.`;
  else if (daysLeft <= 7) text = state === 'TRIAL' ? `Essai gratuit : plus que ${nDays(daysLeft)}.` : `Abonnement : échéance dans ${nDays(daysLeft)}.`;
  if (!text) return null;
  return (
    <div className={state === 'EXPIRED' ? 'msg msg-error subscription-banner' : 'msg msg-warn subscription-banner'}>
      <span>{text}</span>
      <button className="btn" onClick={onOpen}>
        Voir l'abonnement
      </button>
    </div>
  );
}
