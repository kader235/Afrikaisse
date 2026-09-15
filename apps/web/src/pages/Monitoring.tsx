import { useCallback, useEffect, useState } from 'react';
import { CHECK_STATE_LABELS, type CheckState, type Me, type Monitoring, type UpdateStatus } from '@afrikaisse/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { formatDateTime } from '../labels.ts';
import { ErrorMessage, Icon, Window } from '../ui.tsx';
import '../styles/monitoring.css';

const STATE_CLASS: Record<CheckState, string> = { OK: 'st st-ready', WARN: 'st st-pending', ERROR: 'st st-cancelled', NONE: 'st' };

/** État : texte neutre et pastille de couleur. */
export function StateText({ state }: { state: CheckState }) {
  return <span className={STATE_CLASS[state]}>{CHECK_STATE_LABELS[state]}</span>;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const latest = (values: (number | null)[]) => values.reduce<number | null>((m, v) => (v === null ? m : m === null ? v : Math.max(m, v)), null);

function uptime(seconds: number) {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;
  return plural(Math.floor(seconds / 86_400), 'jour');
}

/** Supervision de l'établissement (§68-69) : propriétaire, administrateur, responsable. */
export function MonitoringPage({ me }: { me: Me }) {
  const { locale } = useI18n();
  const [locationId, setLocationId] = useState<string | null>(me.locations[0]?.id ?? null);
  const [data, setData] = useState<Monitoring | null>(null);
  const [error, setError] = useState<unknown>(null);
  const when = (ms: number | null) => (ms ? formatDateTime(ms, locale) : '—');

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      setData(await api<Monitoring>('GET', `/locations/${locationId}/monitoring`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [locationId]);

  useEffect(() => {
    setData(null);
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const rows = data
    ? [
        {
          label: 'Cloud',
          state: data.cloud.state,
          detail: data.profile === 'cloud' ? 'Ce serveur' : (data.cloud.error ?? data.cloud.url ?? 'Non relié'),
          at: data.cloud.lastContactAt,
        },
        {
          label: 'Base de données',
          state: data.database.state,
          detail: data.database.error ?? `${data.database.engine === 'sqlite' ? 'SQLite' : 'PostgreSQL'} · ${data.database.latencyMs ?? '—'} ms`,
          at: data.checkedAt,
        },
        { label: 'API', state: data.api.state, detail: `Version ${data.api.version} · ${data.api.build} · en service depuis ${uptime(data.api.uptimeSec)}`, at: data.api.startedAt },
        {
          label: 'Serveur local',
          state: data.localServer.state,
          detail: data.localServer.servers.length ? data.localServer.servers.map((s) => `${s.name}${s.appVersion ? ` (${s.appVersion})` : ''}`).join(', ') : data.localServer.mode === 'CLOUD' ? 'Établissement exploité en ligne' : 'Aucun serveur relié',
          at: latest(data.localServer.servers.map((s) => s.lastSeenAt)),
        },
        {
          label: 'Synchronisation',
          state: data.sync.state,
          detail: data.sync.paired ? `${data.sync.pending} en attente · ${data.sync.failed} en échec · ${data.sync.conflicts} en conflit${data.sync.error ? ` · ${data.sync.error}` : ''}` : 'Non reliée',
          at: data.sync.lastSuccessAt,
        },
        {
          label: 'Imprimantes',
          state: data.printers.state,
          detail: data.printers.items.length ? `${plural(data.printers.items.length, 'imprimante')} · ${data.printers.items.reduce((t, i) => t + i.pendingJobs, 0)} en attente` : 'Aucune imprimante',
          at: latest(data.printers.items.map((i) => i.lastSuccessAt)),
        },
        { label: 'Écrans cuisine', state: data.kds.state, detail: data.kds.screens.length ? plural(data.kds.screens.length, 'écran') : 'Aucun écran vu depuis 24 h', at: latest(data.kds.screens.map((s) => s.lastSeenAt)) },
        { label: 'Sauvegarde', state: data.backup.state, detail: data.backup.enabled ? (data.backup.lastName ?? 'Aucune copie') : 'Assurée par l’hébergeur', at: data.backup.lastAt },
      ]
    : [];
  const failing = rows.filter((r) => r.state === 'ERROR').map((r) => r.label);
  const current = me.locations.find((l) => l.id === locationId);

  return (
    <Window
      title="Supervision"
      count={current?.name}
      toolbar={
        <>
          {me.locations.length > 1 && (
            <select className="monitoring-location" aria-label="Établissement" value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value)}>
              {me.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn" onClick={() => void load()}>
            <Icon name="refresh" />
            Actualiser
          </button>
        </>
      }
    >
      <ErrorMessage error={error} />
      {data && (
        <>
          <section className="kpi-strip monitoring-summary" aria-label="État du système">
            <div className="kpi">
              <span className="kpi-label">État du système</span>
              <strong className="kpi-value">
                <StateText state={data.overall} />
              </strong>
              <span className="kpi-context">{when(data.checkedAt)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Dernière sauvegarde</span>
              <strong className="kpi-value">{data.backup.enabled ? when(data.backup.lastAt) : '—'}</strong>
              <span className="kpi-context">
                <StateText state={data.backup.state} />
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Dernière synchronisation</span>
              <strong className="kpi-value">{data.sync.paired ? when(data.sync.lastSuccessAt) : '—'}</strong>
              <span className="kpi-context">
                <StateText state={data.sync.state} />
              </span>
            </div>
          </section>

          {failing.length > 0 && (
            <div className="msg msg-error" role="alert">
              En défaut : {failing.join(', ')}
            </div>
          )}

          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Élément</th>
                  <th>État</th>
                  <th>Détail</th>
                  <th>Dernier contact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>
                      <StateText state={r.state} />
                    </td>
                    <td className="monitoring-detail">{r.detail}</td>
                    <td className="num">{when(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.profile === 'cloud' && data.localServer.servers.length > 0 && (
            <fieldset className="group">
              <legend>Serveurs locaux</legend>
              <table className="grid compact">
                <thead>
                  <tr>
                    <th>Serveur</th>
                    <th>État</th>
                    <th>Version</th>
                    <th>Dernier contact</th>
                  </tr>
                </thead>
                <tbody>
                  {data.localServer.servers.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>
                        <StateText state={s.state} />
                      </td>
                      <td>{s.appVersion ?? '—'}</td>
                      <td className="num">{when(s.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </fieldset>
          )}

          {data.printers.items.length > 0 && (
            <fieldset className="group">
              <legend>Imprimantes</legend>
              <div className="grid-wrap">
                <table className="grid compact">
                  <thead>
                    <tr>
                      <th>Imprimante</th>
                      <th>État</th>
                      <th>Dernier succès</th>
                      <th>Dernier échec</th>
                      <th>En attente</th>
                      <th>Erreur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.printers.items.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>
                          <StateText state={p.state} />
                        </td>
                        <td className="num">{when(p.lastSuccessAt)}</td>
                        <td className="num">{when(p.lastFailureAt)}</td>
                        <td className="num">{p.pendingJobs}</td>
                        <td className="monitoring-detail">{p.lastError ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
          )}

          {data.kds.screens.length > 0 && (
            <fieldset className="group">
              <legend>Écrans cuisine</legend>
              <table className="grid compact">
                <thead>
                  <tr>
                    <th>Écran</th>
                    <th>Poste</th>
                    <th>État</th>
                    <th>Dernier signal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.kds.screens.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name ?? `Écran ${s.id.slice(-4).toUpperCase()}`}</td>
                      <td>{s.stationName ?? 'Tous les postes'}</td>
                      <td>
                        <StateText state={s.state} />
                      </td>
                      <td className="num">{when(s.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </fieldset>
          )}

          {data.profile === 'local' && me.permissions.includes('settings.manage') && <UpdatePanel />}
        </>
      )}
    </Window>
  );
}

/** Mise à jour du serveur local (§73) : annonce vérifiée, lien de téléchargement ; rien ne s'installe seul. */
function UpdatePanel() {
  const { locale } = useI18n();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<UpdateStatus>('GET', '/system/update').then(setStatus, setError);
  }, []);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api<UpdateStatus>('POST', '/system/update/check'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <ErrorMessage error={error} />;
  const next = status.updateAvailable ? status.latest : null;
  return (
    <fieldset className="group">
      <legend>Mise à jour</legend>
      <p className="update-line">
        Version actuelle : <strong>{status.currentVersion}</strong>
        {next && (
          <>
            {' — '}Nouvelle version : <strong>{next.version}</strong>
          </>
        )}
      </p>
      <dl className="kv">
        <dt>État</dt>
        <dd>{next ? `Publiée le ${formatDateTime(next.releasedAt, locale)}` : status.lastCheckAt ? 'À jour' : '—'}</dd>
        <dt>Dernière recherche</dt>
        <dd>{status.lastCheckAt ? formatDateTime(status.lastCheckAt, locale) : '—'}</dd>
      </dl>
      {next && (
        <>
          {next.notes && <p className="update-notes">{next.notes}</p>}
          <dl className="kv">
            <dt>Empreinte SHA-256</dt>
            <dd>
              <code className="update-sha">{next.sha256}</code>
            </dd>
          </dl>
        </>
      )}
      {status.lastError && (
        <div className="msg msg-error" role="alert">
          {status.lastError}
        </div>
      )}
      <ErrorMessage error={error} />
      <div className="toolbar" style={{ padding: '8px 0 0' }}>
        {next && (
          <a className="btn btn-primary" href={next.downloadUrl} target="_blank" rel="noopener noreferrer">
            Télécharger la version {next.version}
          </a>
        )}
        <button className="btn" disabled={busy || !status.enabled} onClick={check}>
          <Icon name="refresh" />
          {busy ? 'Recherche…' : 'Rechercher une mise à jour'}
        </button>
      </div>
    </fieldset>
  );
}
