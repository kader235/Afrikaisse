import { LogoAfrikaisse } from './logo.tsx';
import { useEffect, useState } from 'react';
import { GRACE_DAYS, subscriptionState, type Me, type Role, type SessionResponse, type SetupStatus } from '@afrikaisse/core';
import { ApiError, OFFLINE, api, refreshSession, setSession } from './api.ts';
import { useI18n } from './i18n.tsx';
import { ROLE_LABELS } from './labels.ts';
import { AccessScreen, LoginPage, RegisterPage } from './pages/Auth.tsx';
import { AccountPage, AuditPage, OrganizationPage } from './pages/Other.tsx';
import { PlatformPage } from './pages/Platform.tsx';
import { MonitoringPage } from './pages/Monitoring.tsx';
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
import { TakeOrderPage } from './pages/TakeOrder.tsx';
import { isTouchDevice } from './touch.ts';
import { clearCache, readCache, saveCache, useOutboxSender } from './offline.ts';
import { OnboardingWizard } from './pages/Onboarding.tsx';
import { RecoveryPrompt } from './pages/Recovery.tsx';
import { useActivityFeed } from './activity.ts';
import { useNotifications } from './notifications.ts';
import { AlertStack, useStaffAlerts } from './alerts.tsx';
import { SoundSettings } from './pages/SoundSettings.tsx';
import { NotificationPanel } from './pages/Notifications.tsx';
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

type Section = 'dashboard' | 'orders' | 'pos' | 'kitchen' | 'reports' | 'stock' | 'organization' | 'locations' | 'floor' | 'menu' | 'team' | 'audit' | 'account' | 'platform' | 'monitoring' | 'take';

/** Adresse d'entrée directe (console Windows) : `#supervision` → Supervision. */
const sectionFromHash = (): Section | null => (window.location.hash === '#supervision' ? 'monitoring' : null);

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
    // Le bouton « Créer mon restaurant » du site public arrive avec #inscription.
    const anonymous: State = { kind: 'anonymous', screen: window.location.hash === '#inscription' ? 'register' : 'login' };
    refreshSession().then(
      (s) => {
        if (s) saveCache('me', s.me);
        setState(s ? { kind: 'session', me: s.me } : anonymous);
      },
      (err) => {
        const offline = err instanceof ApiError && err.code === OFFLINE;
        // Tablette sans réseau (coupure de courant ou d'Internet) : le dernier compte connu, pour continuer à prendre les commandes.
        const cached = offline && isNativeApp() ? readCache<Me>('me') : null;
        setState(cached ? { kind: 'session', me: cached } : offline ? { kind: 'offline' } : anonymous);
      },
    );
  };
  useEffect(boot, []);

  const onSession = (s: SessionResponse) => {
    setSession(s);
    saveCache('me', s.me);
    setState({ kind: 'session', me: s.me });
  };
  const logout = async () => {
    try {
      await api('POST', '/auth/logout');
    } finally {
      setSession(null);
      clearCache();
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
      return <Shell
          me={state.me}
          onMe={(me) => {
            saveCache('me', me);
            setState({ kind: 'session', me });
          }} onSession={onSession} onLogout={logout} />;
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
type NavItem = { id: Section; label: string; short?: string; icon: IconName; visible: boolean; badge?: number; group: NavGroup };

/** Rubriques de la navigation, dans l'ordre d'une journée de service. */
const NAV_GROUPS: [NavGroup, string][] = [
  ['home', ''],
  ['sale', 'Vente'],
  ['restaurant', 'Restauration'],
  ['manage', 'Gestion'],
  ['admin', 'Administration'],
];

/** Rail de gauche sur PC (design v3) : tout le service, groupé ; le reste (établissements, journal, supervision…) sous « Plus ». */
const PC_RAIL: Section[] = ['dashboard', 'take', 'orders', 'pos', 'floor', 'kitchen', 'menu', 'stock', 'reports', 'team', 'organization'];

/** Intitulés des groupes du rail PC ; la gestion et l'administration sont réunies. */
const RAIL_GROUPS: [NavGroup[], string][] = [
  [['home'], ''],
  [['sale'], 'Vente'],
  [['restaurant'], 'Restaurant'],
  [['manage', 'admin'], 'Gestion'],
];

/** Rail de la tablette et du téléphone : l'outil du métier d'abord, tout le reste sous « Plus ». */
const TABLET_NAV: Record<Role, Section[]> = {
  OWNER: ['take', 'orders', 'pos', 'floor', 'dashboard'],
  ADMIN: ['take', 'orders', 'pos', 'floor', 'dashboard'],
  MANAGER: ['take', 'orders', 'pos', 'floor', 'dashboard'],
  CASHIER: ['pos', 'take', 'orders', 'floor'],
  WAITER: ['take', 'orders', 'floor'],
  KITCHEN: ['kitchen'],
  BAR: ['kitchen'],
  STOCK_MANAGER: ['stock', 'menu'],
};

function Shell({ me, onMe, onSession, onLogout }: { me: Me; onMe: (me: Me) => void; onSession: (s: SessionResponse) => void; onLogout: () => void }) {
  const { t, lang } = useI18n();
  const [error, setError] = useState<unknown>(null);
  const { health, online } = useHealth();
  const can = (p: Me['permissions'][number]) => me.permissions.includes(p);
  // Un seul flux d'activité pour toute l'application : pastille et alertes du personnel sur tous les écrans.
  const feed = useActivityFeed(me.locations[0]?.id ?? null, can('orders.read') && me.tenantAccess === 'OK');
  // Commandes prises pendant une coupure : envoyées dès le retour du réseau, quel que soit l'écran ouvert.
  useOutboxSender(() => feed.refresh());
  const waiting = feed.orders.filter((o) => o.status === 'PENDING').length + feed.requests.length;
  // Centre de notifications : la salle et la caisse (service), la gestion du stock (ruptures).
  const notifyEnabled = me.tenantAccess === 'OK' && (can('orders.create') || can('inventory.read'));
  const notifications = useNotifications(me.locations[0]?.id ?? null, notifyEnabled);

  const sections: NavItem[] = [
    { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard', visible: can('reports.read'), group: 'home' },
    { id: 'take', label: 'Prendre une commande', short: 'Commander', icon: 'cutlery', visible: can('orders.create') && can('tables.read'), group: 'sale' },
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
    { id: 'monitoring', label: 'Supervision', icon: 'server', visible: can('devices.manage'), group: 'admin' },
    { id: 'platform', label: t('nav.platform'), icon: 'server', visible: me.user.isPlatformAdmin && !isTouchDevice(), group: 'admin' },
  ];
  const visible = sections.filter((s) => s.visible);
  // Même rail à gauche partout (design v3) ; l'appareil ne décide que de son contenu et de sa largeur.
  const touch = isTouchDevice();
  const railIds = touch ? TABLET_NAV[me.role ?? 'OWNER'] : PC_RAIL;
  const topNav = railIds.map((id) => visible.find((s) => s.id === id)).filter((s): s is NavItem => !!s);
  if (topNav.length === 0 && visible[0]) topNav.push(visible[0]);
  const railGroups: [string, NavItem[]][] = touch
    ? [['', topNav]]
    : RAIL_GROUPS.map(([groups, title]) => [title, topNav.filter((s) => groups.includes(s.group))] as [string, NavItem[]]).filter(([, list]) => list.length > 0);
  const [panel, setPanel] = useState<'account' | 'nav' | 'notifications' | null>(null);
  const [section, setSection] = useState<Section>(() => sectionFromHash() ?? topNav[0]?.id ?? 'account');
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
  // Qui entend quoi (cuisine, salle, caisse), notification Android, prise en charge des notifications : alerts.tsx.
  const alerts = useStaffAlerts({ me, feed, notifications, onKitchenScreen: current === 'kitchen', onOpen: open });
  // Console Windows : « État du système » ouvre l'application sur #supervision.
  useEffect(() => {
    const onHash = () => {
      const target = sectionFromHash();
      if (target) open(target);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Assistant de mise en route : s'ouvre seul sur un restaurant neuf (une fois par session), se rouvre depuis Paramètres.
  const setupLocationId = can('location.manage') && me.tenantAccess === 'OK' ? (me.locations[0]?.id ?? null) : null;
  const [setupOpen, setSetupOpen] = useState(false);
  // Compte sans question secrète : proposée une fois par session, « Plus tard » la repousse au prochain démarrage.
  const laterKey = `afk.recovery.later.${me.user.id}`;
  const [recoveryLater, setRecoveryLater] = useState(() => {
    try {
      return sessionStorage.getItem(laterKey) === '1';
    } catch {
      return false;
    }
  });
  const postponeRecovery = () => {
    setRecoveryLater(true);
    try {
      sessionStorage.setItem(laterKey, '1');
    } catch {
      /* rappel au prochain affichage */
    }
  };
  useEffect(() => {
    if (!setupLocationId || setupDismissed(setupLocationId)) return;
    api<SetupStatus>('GET', `/locations/${setupLocationId}/setup`).then(
      (s) => s.completedAt === null && !s.isDemo && s.tables === 0 && s.products === 0 && setSetupOpen(true),
      () => undefined,
    );
  }, [setupLocationId]);
  const closeSetup = () => {
    if (setupLocationId) dismissSetup(setupLocationId);
    setSetupOpen(false);
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
      <nav className="rail" aria-label="Navigation principale">
        <div className="rail-brand">
          <LogoAfrikaisse />
          <span className="rail-product">
            Afri<span>Kaisse</span>
          </span>
        </div>
        <div className="rail-items">
          {railGroups.map(([title, list]) => (
            <div key={title || 'home'} className="rail-group">
              {title && <span className="rail-group-title">{title}</span>}
              {list.map((s) => (
                <button key={s.id} className="rail-item" aria-current={current === s.id ? 'page' : undefined} onClick={() => open(s.id)}>
                  <Icon name={s.icon} />
                  <span className="rail-label">{s.short ?? s.label}</span>
                  {!!s.badge && <span className="rail-badge">{s.badge > 99 ? '99+' : s.badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="rail-bottom">
          {!online && (
            <span className="rail-offline" role="status">
              <span className="dot dot-off" aria-hidden="true" />
              Hors ligne
            </span>
          )}
          {notifyEnabled && (
            <button
              className="rail-item rail-bell"
              aria-haspopup="dialog"
              aria-label={notifications.unread > 0 ? `Notifications : ${notifications.unread} non lues` : 'Notifications'}
              onClick={() => setPanel('notifications')}
            >
              <Icon name="bell" />
              <span className="rail-label">Alertes</span>
              {notifications.unread > 0 && <span className="rail-badge">{notifications.unread > 99 ? '99+' : notifications.unread}</span>}
            </button>
          )}
          <button className="rail-item rail-more" aria-haspopup="dialog" aria-current={topNav.some((s) => s.id === current) ? undefined : 'page'} onClick={() => setPanel('nav')}>
            <Icon name="more" />
            <span className="rail-label">Plus</span>
          </button>
          <button className="rail-card" aria-haspopup="dialog" aria-label="Mon compte et réglages" onClick={() => setPanel('account')}>
            <strong>{place}</strong>
            <span>
              {me.user.displayName}
              {roleLabel ? ` · ${roleLabel}` : ''}
            </span>
          </button>
        </div>
      </nav>

      <main className={current === 'take' ? 'workspace workspace-bleed' : 'workspace'}>
        {can('tenant.read') && !touch && <SubscriptionBanner me={me} onOpen={() => open('organization')} />}
        {!!error && <ErrorMessage error={error} />}
        {current === 'dashboard' && <DashboardPage me={me} feed={can('orders.read') ? feed : undefined} onNavigate={open} />}
        {current === 'orders' && <OrdersPage me={me} feed={feed} />}
        {current === 'pos' && <PosPage me={me} />}
        {current === 'take' && <TakeOrderPage me={me} feed={feed} />}
        {current === 'kitchen' && <KitchenPage me={me} feed={feed} />}
        {current === 'reports' && <ReportsPage me={me} />}
        {current === 'stock' && <StockPage me={me} />}
        {current === 'organization' && <OrganizationPage me={me} onRenamed={reloadMe} onOpenSetup={setupLocationId ? () => setSetupOpen(true) : undefined} />}
        {current === 'locations' && <LocationsPage me={me} onChanged={reloadMe} />}
        {current === 'floor' && <FloorPage me={me} feed={feed} />}
        {current === 'menu' && <MenuPage me={me} />}
        {current === 'team' && <TeamPage me={me} />}
        {current === 'audit' && <AuditPage />}
        {current === 'account' && <AccountPage me={me} onChanged={reloadMe} />}
        {current === 'platform' && <PlatformPage />}
        {current === 'monitoring' && <MonitoringPage me={me} />}
      </main>

      {me.user.hasRecovery === false && !!me.user.email && !recoveryLater && !setupOpen && (
        <RecoveryPrompt
          onLater={postponeRecovery}
          onSaved={() => {
            postponeRecovery();
            void reloadMe();
          }}
        />
      )}

      {setupOpen && setupLocationId && (
        <OnboardingWizard
          me={me}
          locationId={setupLocationId}
          onChanged={reloadMe}
          onClose={closeSetup}
          onFinished={() => {
            closeSetup();
            void reloadMe();
            open('dashboard');
          }}
        />
      )}

      <AlertStack alerts={alerts} onOpen={open} />
      {panel === 'notifications' && <NotificationPanel center={notifications} onOpen={open} onClose={() => setPanel(null)} />}
      {(panel === 'account' || panel === 'nav') && (
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

/** Panneau latéral : compte et réglages ; avec « Plus », toute la navigation en plus. */
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
        <SoundSettings me={me} />
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

const SETUP_DISMISSED = 'afk.setup.closed.';

function setupDismissed(locationId: string): boolean {
  try {
    return sessionStorage.getItem(SETUP_DISMISSED + locationId) === '1';
  } catch {
    return false;
  }
}

function dismissSetup(locationId: string) {
  try {
    sessionStorage.setItem(SETUP_DISMISSED + locationId, '1');
  } catch {
    /* stockage indisponible : l'assistant pourra se rouvrir au prochain chargement */
  }
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
