import { useCallback, useEffect, useState } from 'react';
import type { SyncRun, SyncStatus } from '@afrikaisse/core';
import { api } from '../api.ts';
import { ErrorMessage, OkMessage } from '../ui.tsx';

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'jamais');

/** Serveur local : liaison avec AfriKaisse Cloud (n'apparaît pas dans le Cloud). */
export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SyncStatus>('GET', '/system/sync').then(setStatus, () => setStatus(null));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  if (!status) return null;

  async function syncNow() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const run = await api<SyncRun>('POST', '/system/sync/now');
      setStatus(run.status);
      if (!run.status.lastError) setNotice(`${run.pushed} changement(s) envoyé(s), ${run.pulled} reçu(s)${run.conflicts ? `, ${run.conflicts} à revoir` : ''}.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="group">
      <legend>Liaison avec AfriKaisse Cloud</legend>
      {!status.paired ? (
        <p className="muted">Serveur autonome, non relié au Cloud.</p>
      ) : (
        <>
          <dl className="kv">
            <dt>Cloud</dt>
            <dd>{status.cloudUrl}</dd>
            <dt>Dernier envoi</dt>
            <dd>{when(status.lastPushAt)}</dd>
            <dt>Dernière réception</dt>
            <dd>{when(status.lastPullAt)}</dd>
            <dt>En attente d'envoi</dt>
            <dd>
              <strong>{status.pending}</strong>
            </dd>
            {status.conflicts > 0 && (
              <>
                <dt>À revoir</dt>
                <dd>
                  <span className="st st-pending">{status.conflicts}</span>
                </dd>
              </>
            )}
          </dl>
          {status.lastError ? (
            <div className="msg msg-warn">
              Pas de liaison pour l'instant : {status.lastError} Le restaurant continue de fonctionner ; les changements partiront dès le retour d'Internet.
            </div>
          ) : (
            null
          )}
          <ErrorMessage error={error} />
          {notice && !error && <OkMessage>{notice}</OkMessage>}
          <div className="toolbar" style={{ padding: '8px 0 0' }}>
            <button className="btn btn-primary" disabled={busy} onClick={syncNow}>
              {busy ? 'Synchronisation…' : 'Synchroniser maintenant'}
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}
