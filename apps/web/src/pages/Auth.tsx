import { LogoAfrikaisse } from '../logo.tsx';
import { CLOUD_URL as CLOUD_URL_PAR_DEFAUT } from '../platform.ts';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CURRENCY_CODES, LOCATION_TYPES, type SessionResponse } from '@afrikaisse/core';
import { ApiError, api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { COUNTRIES, LOCATION_TYPE_LABELS } from '../labels.ts';
import { APP_VERSION, ErrorMessage, Preferences } from '../ui.tsx';
import { EMPTY_RECOVERY, RecoveryFields } from './Recovery.tsx';

/** Écran d'accès : une fenêtre centrée, une barre d'état. */
/** Sur la tablette : le serveur utilisé, et de quoi en changer depuis n'importe quel écran d'accès. */
export interface ServerSwitch {
  label: string;
  onChange: () => void;
}

export function AccessScreen({ title, wide, bare, children, footer, server }: { title: string; wide?: boolean; bare?: boolean; children: ReactNode; footer: ReactNode; server?: ServerSwitch }) {
  const { t } = useI18n();
  return (
    <div className="login-screen">
      <div className="login-center">
        <div className={wide ? 'access-card access-card-wide' : 'access-card'}>
          <div className="access-brand">
            <LogoAfrikaisse />
            <div>
              <div className="access-name">
                Afri<span>Kaisse</span>
              </div>
              <div className="access-product">{t('app.product')}</div>
            </div>
          </div>
          {!bare && <h1 className="access-title">{title}</h1>}
          <div className="access-body">{children}</div>
          <div className="access-foot">{footer}</div>
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

function FieldIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const [forgot, setForgot] = useState(false);
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

  if (forgot) {
    return <RecoveryScreen server={server} initialEmail={email} onSession={onSession} onCancel={() => setForgot(false)} />;
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
        bare
        server={server}
        title={t('auth.login.title')}
        footer={
          <div className="access-actions">
            <button className="btn btn-primary access-submit" disabled={busy}>
              {busy ? t('common.loading') : t('auth.login.submit')}
            </button>
            <div className="access-links">
              <button type="button" className="link" onClick={onRegister}>
                {t('auth.createRestaurant')}
              </button>
              {canPair && (
                <button type="button" className="link" onClick={() => setPairing(true)}>
                  Relier à AfriKaisse Cloud
                </button>
              )}
            </div>
          </div>
        }
      >
        <ErrorMessage error={error} />
        {paired && (
          <div className="msg msg-ok" role="status">
            {paired}
          </div>
        )}
        <div className="access-field">
          <label htmlFor="login-email">{t('auth.email')}</label>
          <div className="access-input">
            <FieldIcon d="M2.5 4h11v8h-11zM2.5 4.5L8 9l5.5-4.5" />
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              placeholder={t('auth.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="access-field">
          <label htmlFor="login-password">{t('auth.password')}</label>
          <div className="access-input">
            <FieldIcon d="M4 7.5h8v6H4zM5.5 7.5v-2a2.5 2.5 0 0 1 5 0v2" />
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              placeholder={t('auth.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="button" className="link access-forgot" onClick={() => setForgot(true)}>
            {t('auth.forgot')}
          </button>
        </div>
      </AccessScreen>
    </form>
  );
}

/**
 * Mot de passe oublié : l'adresse du compte, puis la question secrète choisie à sa création.
 * La bonne réponse et un nouveau mot de passe suffisent : la personne est connectée aussitôt.
 */
function RecoveryScreen({ server, initialEmail, onSession, onCancel }: { server?: ServerSwitch; initialEmail: string; onSession: (s: SessionResponse) => void; onCancel: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMismatch(false);
    if (question !== null && password !== confirm) {
      setMismatch(true);
      return;
    }
    setBusy(true);
    try {
      if (question === null) {
        setQuestion((await api<{ question: string }>('POST', '/auth/recovery/question', { email })).question);
      } else {
        onSession(await api<SessionResponse>('POST', '/auth/recovery/reset', { email, answer, newPassword: password }));
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const noQuestion = error instanceof ApiError && error.code === 'NOT_FOUND';

  return (
    <form onSubmit={submit}>
      <AccessScreen
        server={server}
        title="Mot de passe oublié"
        footer={
          <div className="access-actions">
            <button className="btn btn-primary access-submit" disabled={busy}>
              {busy ? 'Vérification…' : question === null ? 'Continuer' : 'Changer le mot de passe'}
            </button>
            <div className="access-links">
              <button type="button" className="link" onClick={question === null ? onCancel : () => (setQuestion(null), setError(null))}>
                {question === null ? 'Retour à la connexion' : "Changer d'adresse e-mail"}
              </button>
            </div>
          </div>
        }
      >
        <ErrorMessage error={error} />
        {noQuestion && (
          <p className="access-note">
            Compte créé avant la question secrète : sur un appareil encore connecté, choisissez-la dans Mon compte. Sinon, un administrateur du restaurant peut vous
            donner un nouveau mot de passe (Équipe).
          </p>
        )}
        {mismatch && (
          <div className="msg msg-error" role="alert">
            <strong>Erreur :</strong> les deux mots de passe ne sont pas identiques.
          </div>
        )}
        {question === null ? (
          <>
            <p className="access-intro">Saisissez l'adresse e-mail de votre compte. La question secrète choisie à sa création vous sera posée.</p>
            <div className="access-field">
              <label htmlFor="rec-email">Adresse e-mail</label>
              <div className="access-input">
                <FieldIcon d="M2.5 4h11v8h-11zM2.5 4.5L8 9l5.5-4.5" />
                <input id="rec-email" type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="access-question">
              <small>Question secrète de {email}</small>
              <strong>{question}</strong>
            </div>
            <div className="access-field">
              <label htmlFor="rec-answer">Votre réponse</label>
              <div className="access-input">
                <FieldIcon d="M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.4v.1" />
                <input id="rec-answer" required autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              </div>
            </div>
            <div className="access-field">
              <label htmlFor="rec-password">Nouveau mot de passe</label>
              <div className="access-input">
                <FieldIcon d="M4 7.5h8v6H4zM5.5 7.5v-2a2.5 2.5 0 0 1 5 0v2" />
                <input id="rec-password" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <div className="access-field">
              <label htmlFor="rec-confirm">Confirmer le nouveau mot de passe</label>
              <div className="access-input">
                <FieldIcon d="M4 7.5h8v6H4zM5.5 7.5v-2a2.5 2.5 0 0 1 5 0v2" />
                <input id="rec-confirm" type="password" required minLength={10} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <span className="access-note">Au moins 10 caractères. Vos autres appareils seront déconnectés.</span>
            </div>
          </>
        )}
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
  const [recovery, setRecovery] = useState(EMPTY_RECOVERY);
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
      onSession(await api<SessionResponse>('POST', '/auth/register', { ...form, recoveryQuestion: recovery.question, recoveryAnswer: recovery.answer }));
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
        <fieldset className="group">
          <legend>Récupération du compte</legend>
          <div className="form">
            <RecoveryFields id="r-rec" value={recovery} onChange={setRecovery} />
          </div>
        </fieldset>
      </AccessScreen>
    </form>
  );
}
