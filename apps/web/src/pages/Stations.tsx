import { useState, type FormEvent } from 'react';
import { STATION_KINDS, STATION_KIND_LABELS, type AdminMenu, type Station, type StationKind } from '@afrikaisse/core';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, Icon, OkMessage } from '../ui.tsx';

/** Postes de préparation d'un établissement (onglet du Menu). */
export function StationsTab({ menu, canManage, onChanged }: { menu: AdminMenu; canManage: boolean; onChanged: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { station?: Station }>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = menu.stations.find((s) => s.id === selectedId) ?? null;
  const defaultKitchen = menu.stations.find((s) => s.kind === 'KITCHEN');
  const unassigned = menu.products.filter((p) => !p.stationId).length;

  async function archive(station: Station) {
    setError(null);
    setNotice(null);
    try {
      await api('POST', `/stations/${station.id}/archive`);
      setSelectedId(null);
      setNotice(`Poste « ${station.name} » archivé.`);
      onChanged();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      {canManage && (
        <div className="toolbar">
          <button className="btn" onClick={() => setDialog({})}>
            <Icon name="add" />
            Nouveau poste
          </button>
          <button className="btn" disabled={!selected} onClick={() => selected && setDialog({ station: selected })}>
            <Icon name="edit" />
            Modifier
          </button>
          <button className="btn" disabled={!selected} onClick={() => selected && archive(selected)}>
            <Icon name="archive" />
            Archiver
          </button>
        </div>
      )}
      <div className="window-body" style={{ paddingBottom: 0 }}>
        <ErrorMessage error={error} />
        {notice && !error && <OkMessage>{notice}</OkMessage>}
      </div>
      <div className="grid-wrap" style={{ marginTop: 10 }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Poste</th>
              <th>Type</th>
              <th>Produits affectés</th>
            </tr>
          </thead>
          <tbody>
            {menu.stations.length === 0 && (
              <tr>
                <td className="empty" colSpan={3}>
                  Aucun poste : les commandes s'affichent sur « Tous les postes ».
                </td>
              </tr>
            )}
            {menu.stations.map((s) => (
              <tr key={s.id} className="selectable" aria-selected={s.id === selectedId} onClick={() => setSelectedId(s.id)}>
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td>{STATION_KIND_LABELS[s.kind]}</td>
                <td className="num">{s.productCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog && (
        <StationDialog
          locationId={menu.location.id}
          station={dialog.station}
          onClose={() => setDialog(null)}
          onDone={(name) => {
            setDialog(null);
            setError(null);
            setNotice(dialog.station ? `Poste « ${name} » enregistré.` : `Poste « ${name} » créé.`);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function StationDialog({ locationId, station, onDone, onClose }: { locationId: string; station?: Station; onDone: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(station?.name ?? '');
  const [kind, setKind] = useState<StationKind>(station?.kind ?? 'KITCHEN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (station) await api('PATCH', `/stations/${station.id}`, { name: name.trim(), kind });
      else await api('POST', `/locations/${locationId}/stations`, { name: name.trim(), kind });
      onDone(name.trim());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={station ? `Modifier le poste — ${station.name}` : 'Nouveau poste'}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !name.trim()}>
              Enregistrer
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Annuler
            </button>
          </>
        }
      >
        <div className="dialog-body">
          <ErrorMessage error={error} />
          <div className="form">
            <label htmlFor="st-name">Nom</label>
            <input id="st-name" required maxLength={40} autoFocus placeholder="Grill, Pâtisserie, Bar terrasse…" value={name} onChange={(e) => setName(e.target.value)} />
            <label>Type</label>
            <span className="segmented">
              {STATION_KINDS.map((k) => (
                <button type="button" key={k} className="btn" aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {STATION_KIND_LABELS[k]}
                </button>
              ))}
            </span>
          </div>
        </div>
      </Dialog>
    </form>
  );
}
