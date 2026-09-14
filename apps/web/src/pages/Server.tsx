import { useState, type FormEvent } from 'react';
import { normalizeServerUrl } from '@afrikaisse/core';
import { checkServer, type ServerHealth } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { CLOUD_URL, type ServerChoice } from '../platform.ts';
import { AccessScreen } from './Auth.tsx';

/**
 * Premier écran de la tablette : à quel serveur parler ?
 * On n'enregistre une adresse qu'après avoir vérifié qu'un serveur AfriKaisse y répond.
 */
export function ServerPage({ current, onSaved }: { current: ServerChoice | null; onSaved: (choice: ServerChoice) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<ServerChoice['kind']>(current?.kind ?? 'cloud');
  const [address, setAddress] = useState(current?.kind === 'local' ? current.url.replace(/^https?:\/\//, '') : '');
  const [tested, setTested] = useState<{ url: string; health: ServerHealth } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = kind === 'cloud' ? ({ ok: true, url: CLOUD_URL } as const) : normalizeServerUrl(address);
  const ready = tested !== null && target.ok && tested.url === target.url;

  async function test(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setTested(null);
    if (!target.ok) {
      setError(target.message);
      return;
    }
    setBusy(true);
    try {
      setTested({ url: target.url, health: await checkServer(target.url) });
    } catch {
      setError(kind === 'local' ? t('server.unreachableLocal') : t('server.unreachableCloud'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={test}>
      <AccessScreen
        title={t('server.title')}
        footer={
          <div className="login-foot">
            <button className="btn" disabled={busy}>
              {busy ? t('common.loading') : t('server.test')}
            </button>
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => ready && onSaved({ kind, url: tested.url })}>
              {t('server.use')}
            </button>
          </div>
        }
      >
        <div className="choices" role="radiogroup">
          <label className="choice">
            <input
              type="radio"
              name="server-kind"
              checked={kind === 'cloud'}
              onChange={() => {
                setKind('cloud');
                setTested(null);
              }}
            />
            <span>
              <strong>{t('server.cloud')}</strong>
              <small>{CLOUD_URL.replace(/^https:\/\//, '')}</small>
            </span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="server-kind"
              checked={kind === 'local'}
              onChange={() => {
                setKind('local');
                setTested(null);
              }}
            />
            <span>
              <strong>{t('server.local')}</strong>
            </span>
          </label>
        </div>
        {kind === 'local' && (
          <div className="form" style={{ marginTop: 12, gridTemplateColumns: '120px minmax(0,1fr)' }}>
            <label htmlFor="server-address">{t('server.address')}</label>
            <input
              id="server-address"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="192.168.1.20:7300"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setTested(null);
              }}
            />
          </div>
        )}
        {error && (
          <div className="msg msg-error" role="alert" style={{ marginTop: 12 }}>
            <strong>Erreur :</strong> {error}
          </div>
        )}
        {ready && (
          <div className="msg msg-ok" role="status" style={{ marginTop: 12 }}>
            {t('server.connected')} {tested.health.profile === 'local' ? t('status.local') : t('status.cloud')} ·{' '}
            {tested.health.database === 'postgres' ? 'PostgreSQL' : 'SQLite'} · {t('status.version')} {tested.health.version}
          </div>
        )}
      </AccessScreen>
    </form>
  );
}
