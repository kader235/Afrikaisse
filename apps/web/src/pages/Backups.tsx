import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage, OkMessage } from '../ui.tsx';

interface BackupList {
  enabled: boolean;
  dir: string | null;
  files: { name: string; size: number; createdAt: number }[];
}

const size = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} Ko` : `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} Mo`);

/** Sauvegardes du serveur local (§69) : n'apparaît que sur le serveur du restaurant. */
export function BackupsPanel() {
  const [data, setData] = useState<BackupList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<BackupList>('GET', '/system/backups').then(setData, () => setData(null));
  }, []);
  useEffect(load, [load]);

  if (!data?.enabled) return null;

  async function backup() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const file = await api<{ name: string; size: number }>('POST', '/system/backups');
      setNotice(`Sauvegarde vérifiée : ${file.name} (${size(file.size)}).`);
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="group" style={{ maxWidth: 720, marginTop: 14 }}>
      <legend>Sauvegardes de ce serveur</legend>
      <p>
        Une copie vérifiée de la base est faite au démarrage puis toutes les heures : les 24 dernières, et une par jour sur 30 jours, dans <code>{data.dir}</code>.
      </p>
      <p className="muted">Copiez régulièrement ce dossier sur une clé USB ou un autre ordinateur : une panne de disque emporterait aussi les copies.</p>
      <ErrorMessage error={error} />
      {notice && !error && <OkMessage>{notice}</OkMessage>}
      <div className="toolbar" style={{ padding: '8px 0' }}>
        <button className="btn btn-primary" disabled={busy} onClick={backup}>
          {busy ? 'Sauvegarde…' : 'Sauvegarder maintenant'}
        </button>
      </div>
      <table className="grid compact">
        <thead>
          <tr>
            <th>Date</th>
            <th>Fichier</th>
            <th>Taille</th>
          </tr>
        </thead>
        <tbody>
          {data.files.length === 0 && (
            <tr>
              <td className="empty" colSpan={3}>
                Aucune sauvegarde pour l'instant.
              </td>
            </tr>
          )}
          {data.files.slice(0, 10).map((f) => (
            <tr key={f.name}>
              <td>{new Date(f.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{f.name}</td>
              <td className="num">{size(f.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}
