import { CLOUD_URL as CLOUD_URL_PAR_DEFAUT } from '../platform.ts';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CURRENCY_CODES, LOCATION_TYPES, type SessionResponse } from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { COUNTRIES, LOCATION_TYPE_LABELS } from '../labels.ts';
import { APP_VERSION, BrandMark, ErrorMessage, Preferences } from '../ui.tsx';

/** Écran d'accès : une fenêtre centrée, une barre d'état. */
/** Sur la tablette : le serveur utilisé, et de quoi en changer depuis n'importe quel écran d'accès. */
export interface ServerSwitch {
  label: string;
  onChange: () => void;
}

export function AccessScreen({ title, wide, children, footer, server }: { title: string; wide?: boolean; children: ReactNode; footer: ReactNode; server?: ServerSwitch }) {
  const { t } = useI18n();
  return (
    <div className="login-screen">
      <div className="login-center">
        <div className={wide ? 'dialog dialog-wide' : 'dialog'} style={{ maxWidth: wide ? 680 : 440 }}>
          <div className="dialog-title">
            <span>AfriKaisse — {title}</span>
          </div>
          <div className="dialog-body">
            <div className="login-head">
              <BrandMark />
              <div>
                <strong>AfriKaisse</strong>
                <span className="muted">{t('app.product')}</span>
              </div>
            </div>
            {children}
          </div>
          <div className="dialog-foot">{footer}</div>
        </div>
      </div>
      <footer className="statusbar">
        <span>GLOBALTECH BUSINESS TD</span>
        <span>
          {t('status.version')} {APP_VERSION}
        </span>
        {server && (
          <span>
            {t('server.label')} : {server.label}{' '}
            <button type="button" className="link" onClick={server.onChange}>
              {t('server.change')}
            </button>
          </span>
        )}
        <span className="push">
          <Preferences />
        </span>
      </footer>
    </div>
  );
}

export function LoginPage({ onSession, onRegister, server }: { onSession: (s: SessionResponse) => void; onRegister: () => void; server?: ServerSwitch }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Serveur local neuf : il peut être relié à un établissement du Cloud au lieu d'en créer un.
  const [canPair, setCanPair] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [paired, setPaired] = useState<string | null>(null);
  useEffect(() => {
    api<{ profile: string; configured?: boolean }>('GET', '/health').then(
      (h) => setCanPair(h.profile === 'local' && h.configured === false),
      () => setCanPair(false),
    );
  }, [pairing]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSession(await api<SessionResponse>('POST', '/auth/login', { email, password }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (pairing) {
    return (
      <PairScreen
        server={server}
        onCancel={() => setPairing(false)}
        onDone={(message) => {
          setPaired(message);
          setPairing(false);
        }}
      />
    );
  }

  return (
    <form onSubmit={submit}>
      <AccessScreen
        server={server}
        title={t('auth.login.title')}
        footer={
          <div className="login-foot">
            <button type="button" className="link" onClick={onRegister}>
              {t('auth.createRestaurant')}
            </button>
            {canPair && (
              <button type="button" className="link" onClick={() => setPairing(true)}>
                Relier à AfriKaisse Cloud
              </button>
            )}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? t('common.loading') : t('auth.login.submit')}
            </button>
          </div>
        }
      >
        <ErrorMessage error={error} />
        {paired && (
          <div className="msg msg-ok" role="status">
            {paired}
          </div>
        )}
        <div className="form" style={{ gridTemplateColumns: '120px minmax(0,1fr)' }}>
          <label htmlFor="login-email">{t('auth.email')}</label>
          <input id="login-email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="login-password">{t('auth.password')}</label>
          <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </AccessScreen>
    </form>
  );
}

/** Serveur local neuf : reprendre un établissement du Cloud (équipe, salle, carte) avec un code d'appairage. */
function PairScreen({ server, onDone, onCancel }: { server?: ServerSwitch; onDone: (message: string) => void; onCancel: () => void }) {
  const [cloudUrl, setCloudUrl] = useState(CLOUD_URL_PAR_DEFAUT);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ organization: string; location: string }>('POST', '/system/sync/pair', { cloudUrl: cloudUrl.trim(), code });
      onDone(`Serveur relié à « ${r.organization} — ${r.location} ». Connectez-vous avec votre compte AfriKaisse Cloud.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <AccessScreen
        server={server}
        title="Relier au Cloud"
        footer={
          <div className="login-foot">
            <button type="button" className="link" onClick={onCancel}>
              Retour
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Appairage…' : 'Relier ce serveur'}
            </button>
          </div>
        }
      >
        <ErrorMessage error={error} />
        <p className="muted" style={{ marginBottom: 10 }}>
          Dans AfriKaisse Cloud, menu Établissements : choisissez l'établissement, puis « Relier un serveur local ». Un code de 8 caractères s'affiche pendant 10 minutes. L'équipe, la salle et la carte
          sont copiées sur ce PC ; les ventes remontent ensuite au Cloud dès qu'Internet est là.
        </p>
        <div className="form" style={{ gridTemplateColumns: '140px minmax(0,1fr)' }}>
          <label htmlFor="pair-url">Adresse du Cloud</label>
          <input id="pair-url" type="url" required value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} />
          <label htmlFor="pair-code">Code</label>
          <input id="pair-code" required autoFocus autoComplete="off" maxLength={9} placeholder="K7QM-3XRA" style={{ letterSpacing: '0.1em' }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </div>
      </AccessScreen>
    </form>
  );
}

export function RegisterPage({ onSession, onLogin, server }: { onSession: (s: SessionResponse) => void; onLogin: () => void; server?: ServerSwitch }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    organizationName: '',
    locationName: '',
    locationType: 'RESTAURANT',
    country: 'TD',
    timezone: 'Africa/Ndjamena',
    currency: 'XAF',
    ownerName: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function selectCountry(code: string) {
    const c = COUNTRIES.find((x) => x.code === code)!;
    setForm((f) => ({ ...f, country: c.code, timezone: c.timezone, currency: c.currency }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSession(await api<SessionResponse>('POST', '/auth/register', form));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <AccessScreen
        wide
        server={server}
        title={t('auth.register.title')}
        footer={
          <div className="login-foot">
            <button type="button" className="link" onClick={onLogin}>
              {t('auth.haveAccount')} {t('auth.login.submit')}
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? t('common.loading') : t('auth.register.submit')}
            </button>
          </div>
        }
      >
        <ErrorMessage error={error} />
        <fieldset className="group">
          <legend>{t('auth.groupOrganization')}</legend>
          <div className="form">
            <label htmlFor="r-org">{t('auth.organizationName')}</label>
            <input id="r-org" required minLength={2} autoFocus value={form.organizationName} onChange={set('organizationName')} />
            <span className="hint">{t('auth.organizationHint')}</span>
          </div>
        </fieldset>
        <fieldset className="group">
          <legend>{t('auth.groupLocation')}</legend>
          <div className="form">
            <label htmlFor="r-loc">{t('team.name')}</label>
            <input id="r-loc" required minLength={2} value={form.locationName} onChange={set('locationName')} />
            <label htmlFor="r-type">{t('auth.locationType')}</label>
            <select id="r-type" value={form.locationType} onChange={set('locationType')}>
              {LOCATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {LOCATION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <label htmlFor="r-country">{t('auth.country')}</label>
            <select id="r-country" value={form.country} onChange={(e) => selectCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <label htmlFor="r-currency">{t('auth.currency')}</label>
            <select id="r-currency" value={form.currency} onChange={set('currency')}>
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        <fieldset className="group">
          <legend>{t('auth.groupOwner')}</legend>
          <div className="form">
            <label htmlFor="r-owner">{t('auth.ownerName')}</label>
            <input id="r-owner" required minLength={2} autoComplete="name" value={form.ownerName} onChange={set('ownerName')} />
            <label htmlFor="r-email">{t('auth.email')}</label>
            <input id="r-email" type="email" required autoComplete="username" value={form.email} onChange={set('email')} />
            <label htmlFor="r-password">{t('auth.password')}</label>
            <input id="r-password" type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set('password')} />
            <span className="hint">{t('auth.passwordHint')}</span>
          </div>
        </fieldset>
      </AccessScreen>
    </form>
  );
}
