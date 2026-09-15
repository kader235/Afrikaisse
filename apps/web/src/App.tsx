import { LogoAfrikaisse } from './logo.tsx';
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
import { DashboardPage } from './pages/Dashboard.tsx';
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

type Section = 'dashboard' | 'orders' | 'pos' | 'kitchen' | 'reports' | 'stock' | 'organization' | 'locations' | 'floor' | 'menu' | 'team' | 'audit' | 'account' | 'platform';

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

/** État de la liaison : uniquement des informations réelles, rafraîchies toutes les 30 s. */
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

type NavGroup = 'home' | 'sale' | 'restaurant' | 'manage' | 'admin';
type NavItem = { id: Section; label: string; icon: IconName; visible: boolean; badge?: number; group: NavGroup };

/** Rubriques de la navigation, dans l'ordre d'une journée de service. */
const NAV_GROUPS: [NavGroup, string][] = [
  ['home', ''],
  ['sale', 'Vente'],
  ['restaurant', 'Restauration'],
  ['manage', 'Gestion'],
  ['admin', 'Administration'],
];

/** Accès rapides du téléphone (barre du bas), par métier : chacun ouvre son outil. */
const TAB_PRIORITY: Record<Role, Section[]> = {
  OWNER: ['dashboard', 'orders', 'pos', 'menu'],
  ADMIN: ['dashboard', 'orders', 'pos', 'menu'],
  MANAGER: ['dashboard', 'orders', 'pos', 'floor'],
  CASHIER: ['pos', 'orders'],
  WAITER: ['floor', 'orders'],
  KITCHEN: ['kitchen'],
  BAR: ['kitchen'],
  STOCK_MANAGER: ['stock', 'menu'],
};

/** Initiales affichées dans la barre supérieure : « Achta Démo » → « AD ». */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

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
    { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard', visible: can('reports.read'), group: 'home' },
    { id: 'pos', label: t('nav.pos'), icon: 'cash', visible: can('pos.use') || can('payments.collect'), group: 'sale' },
    { id: 'orders', label: t('nav.orders'), icon: 'ticket', visible: can('orders.read'), badge: waiting, group: 'sale' },
    { id: 'floor', label: t('nav.floor'), icon: 'table', visible: can('tables.read'), group: 'sale' },
    { id: 'kitchen', label: t('nav.kitchen'), icon: 'kitchen', visible: can('kitchen.use') || can('bar.use'), group: 'restaurant' },
    { id: 'menu', label: t('nav.menu'), icon: 'menu', visible: can('menu.read'), group: 'restaurant' },
    { id: 'stock', label: t('nav.stock'), icon: 'box', visible: can('inventory.read'), group: 'manage' },
    { id: 'team', label: t('nav.team'), icon: 'team', visible: can('users.read'), group: 'admin' },
    { id: 'reports', label: t('nav.reports'), icon: 'chart', visible: can('reports.read'), group: 'admin' },
    { id: 'locations', label: t('nav.locations'), icon: 'store', visible: can('location.read'), group: 'admin' },
    { id: 'organization', label: t('nav.organization'), icon: 'gear', visible: can('tenant.read'), group: 'admin' },
    { id: 'audit', label: t('nav.audit'), icon: 'journal', visible: can('audit.read'), group: 'admin' },
    { id: 'platform', label: t('nav.platform'), icon: 'server', visible: me.user.isPlatformAdmin, group: 'admin' },
  ];
  const visible = sections.filter((s) => s.visible);
  const quick = TAB_PRIORITY[me.role ?? 'OWNER']
    .map((id) => visible.find((s) => s.id === id))
    .filter((s): s is NavItem => !!s)
    .slice(0, 4);
  if (quick.length === 0 && visible[0]) quick.push(visible[0]);
  const [panel, setPanel] = useState<'account' | 'nav' | null>(null);
  const [section, setSection] = useState<Section>(() => quick[0]?.id ?? 'account');
  const current: Section = section === 'account' || visible.some((s) => s.id === section) ? section : (visible[0]?.id ?? 'account');
  const roleLabel = me.role ? ROLE_LABELS[lang][me.role] : '';
  const place = me.locations.length === 1 ? me.locations[0]!.name : (me.tenant?.name ?? 'AfriKaisse');

  async function switchTo(tenantId: string) {
    setError(null);
    try {
      onSession(await api<SessionResponse>('POST', '/auth/switch-tenant', { tenantId }));
    } catch (err) {
      setError(err);
    }
  }
  const reloadMe = () => api<Me>('GET', '/auth/me').then(onMe, setError);
  const open = (id: Section) => {
    setSection(id);
    setPanel(null);
  };

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
        <button className="topbar-menu" aria-label="Menu" aria-haspopup="dialog" onClick={() => setPanel('nav')}>
          <Icon name="list" />
        </button>
        <div className="topbar-brand">
          <LogoAfrikaisse />
          <span className="topbar-product">
            Afri<span>Kaisse</span>
          </span>
        </div>
        <div className="topbar-context">
          <span className="topbar-place">{place}</span>
          {me.tenant && place !== me.tenant.name && <span className="topbar-org">{me.tenant.name}</span>}
        </div>
        <div className="topbar-side">
          <span className={online ? 'topbar-status' : 'topbar-status off'}>
            <span className={online ? 'dot dot-ok' : 'dot dot-off'} aria-hidden="true" />
            {online ? 'En ligne' : 'Hors ligne'}
          </span>
          {can('orders.read') && (
            <button className="topbar-bell" aria-label={waiting > 0 ? `${waiting} à traiter` : 'Commandes'} onClick={() => open('orders')}>
              <Icon name="bell" />
              {waiting > 0 && <span className="badge-count">{waiting}</span>}
            </button>
          )}
          <button className="topbar-user" aria-haspopup="dialog" aria-label="Mon compte et réglages" onClick={() => setPanel('account')}>
            <span className="topbar-initials" aria-hidden="true">
              {initials(me.user.displayName)}
            </span>
            <span className="topbar-name">
              <strong>{me.user.displayName}</strong>
              <span>{roleLabel}</span>
            </span>
            <Icon name="chevron" />
          </button>
        </div>
      </header>

      <nav className="sidebar" aria-label="Navigation">
        <NavList items={visible} current={current} onPick={open} />
        {/* Rail de la tablette : l'administration passe sous « Plus » pour garder des libellés entiers. */}
        <button
          className="nav-item nav-more"
          aria-haspopup="dialog"
          aria-current={visible.some((s) => s.group === 'admin' && s.id === current) ? 'page' : undefined}
          onClick={() => setPanel('nav')}
        >
          <Icon name="more" />
          <span className="nav-label">Plus</span>
        </button>
      </nav>

      <main className="workspace">
        {can('tenant.read') && <SubscriptionBanner me={me} onOpen={() => open('organization')} />}
        {!!error && <ErrorMessage error={error} />}
        {current === 'dashboard' && <DashboardPage me={me} feed={can('orders.read') ? feed : undefined} onNavigate={open} />}
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

      <nav className="bottombar" aria-label="Accès rapide">
        {quick.map((s) => (
          <NavButton key={s.id} item={s} current={current} onPick={open} />
        ))}
        <button className="nav-item" aria-haspopup="dialog" onClick={() => setPanel('nav')}>
          <Icon name="list" />
          <span className="nav-label">Plus</span>
        </button>
      </nav>

      <footer className="status-strip" aria-label="Barre d'état">
        <span>
          <span className={online ? 'dot dot-ok' : 'dot dot-off'} aria-hidden="true" />
          {online ? t('status.connected') : t('status.offline')}
        </span>
        {health && <span>{health.profile === 'cloud' ? t('status.cloud') : t('status.local')}</span>}
        <span className="status-grow">
          {place}
          {me.tenant && place !== me.tenant.name ? ` · ${me.tenant.name}` : ''}
        </span>
        <span>
          {me.user.displayName}
          {roleLabel ? ` · ${roleLabel}` : ''}
        </span>
        <StatusClock locale={lang === 'ar' ? 'ar-TD' : lang === 'en' ? 'en-GB' : 'fr-FR'} />
        <span>AfriKaisse {health?.version ?? APP_VERSION}</span>
      </footer>

      {panel && (
        <SidePanel
          mode={panel}
          me={me}
          roleLabel={roleLabel}
          items={visible}
          current={current}
          health={health}
          online={online}
          onSelect={open}
          onSwitch={switchTo}
          onLogout={onLogout}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

function NavButton({ item, current, onPick }: { item: NavItem; current: Section; onPick: (id: Section) => void }) {
  return (
    <button className="nav-item" aria-current={current === item.id ? 'page' : undefined} onClick={() => onPick(item.id)}>
      <Icon name={item.icon} />
      <span className="nav-label">{item.label}</span>
      {!!item.badge && <span className="badge-count">{item.badge}</span>}
    </button>
  );
}

function NavList({ items, current, onPick }: { items: NavItem[]; current: Section; onPick: (id: Section) => void }) {
  return (
    <>
      {NAV_GROUPS.map(([group, title]) => {
        const list = items.filter((i) => i.group === group);
        if (list.length === 0) return null;
        return (
          <div key={group} className={`nav-group nav-group-${group}`}>
            {title && <h2 className="nav-title">{title}</h2>}
            {list.map((item) => (
              <NavButton key={item.id} item={item} current={current} onPick={onPick} />
            ))}
          </div>
        );
      })}
    </>
  );
}

/** Panneau latéral : compte et réglages ; sur téléphone (« Plus »), toute la navigation en plus. */
function SidePanel({
  mode,
  me,
  roleLabel,
  items,
  current,
  health,
  online,
  onSelect,
  onSwitch,
  onLogout,
  onClose,
}: {
  mode: 'account' | 'nav';
  me: Me;
  roleLabel: string;
  items: NavItem[];
  current: Section;
  health: Health | null;
  online: boolean;
  onSelect: (id: Section) => void;
  onSwitch: (tenantId: string) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="panel-overlay" role="presentation" onClick={onClose}>
      <aside className="side-panel" role="dialog" aria-modal="true" aria-label={mode === 'nav' ? 'Menu' : t('nav.account')} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="panel-who">
            <strong>{me.user.displayName}</strong>
            <span>
              {roleLabel}
              {me.tenant ? ` · ${me.tenant.name}` : ''}
            </span>
          </div>
          <button className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {mode === 'nav' && (
          <div className="panel-section panel-nav">
            <NavList items={items} current={current} onPick={onSelect} />
          </div>
        )}
        {me.tenant && me.memberships.length > 1 && (
          <label className="panel-section">
            <h2>{t('shell.switchOrg')}</h2>
            <select value={me.tenant.id} onChange={(e) => onSwitch(e.target.value)}>
              {me.memberships.map((m) => (
                <option key={m.membershipId} value={m.tenantId}>
                  {m.tenantName}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="panel-section">
          <h2>Compte</h2>
          <button className="nav-item" aria-current={current === 'account' ? 'page' : undefined} onClick={() => onSelect('account')}>
            <Icon name="user" />
            <span className="nav-label">{t('nav.account')}</span>
          </button>
        </div>
        <div className="panel-section panel-prefs">
          <h2>Affichage</h2>
          <Preferences />
        </div>
        <div className="panel-info">
          <span>
            <span className={online ? 'dot dot-ok' : 'dot dot-off'} />
            {online ? t('status.connected') : t('status.offline')}
            {health && ` · ${health.profile === 'cloud' ? t('status.cloud') : t('status.local')}`}
          </span>
          {health?.profile === 'local' && !!health.lanUrls?.length && <span>Adresse pour les tablettes : {health.lanUrls.map((u) => u.replace(/^http:\/\//, '')).join(' · ')}</span>}
          <span>
            GLOBALTECH BUSINESS TD · {t('status.version')} {health?.version ?? APP_VERSION}
          </span>
        </div>
        <button className="btn panel-logout" onClick={onLogout}>
          <Icon name="logout" />
          {t('common.logout')}
        </button>
      </aside>
    </div>
  );
}

/** Date et heure de la barre d'état, remises à jour chaque minute. */
function StatusClock({ locale }: { locale: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="num">
      {now.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}{' '}
      {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
    </span>
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
