import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PRINT_JOB_KIND_LABELS, type Printer, type PrintJob, type Station } from '@afrikaisse/core';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, Icon, OkMessage } from '../ui.tsx';

/**
 * Imprimantes thermiques réseau (onglet du Menu) : tickets cuisine par poste, reçus.
 * L'envoi part du serveur AfriKaisse du restaurant ; la file montre ce qui n'est pas sorti.
 */
export function PrintersTab({ locationId, stations }: { locationId: string; stations: Station[] }) {
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { printer?: Printer }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = printers?.find((p) => p.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const [list, queue] = await Promise.all([api<Printer[]>('GET', `/locations/${locationId}/printers`), api<PrintJob[]>('GET', `/locations/${locationId}/print-jobs`)]);
      setPrinters(list);
      setJobs(queue);
    } catch (err) {
      setError(err);
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const test = (p: Printer) =>
    run(async () => {
      const result = await api<Printer>('POST', `/printers/${p.id}/test`);
      if (result.lastError) throw new Error(result.lastError);
      setNotice(`Ticket de test envoyé à « ${p.name} ».`);
    });

  const failed = jobs.filter((j) => j.status === 'FAILED').length;

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => setDialog({})}>
          <Icon name="add" />
          Nouvelle imprimante
        </button>
        <button className="btn" disabled={!selected} onClick={() => selected && setDialog({ printer: selected })}>
          <Icon name="edit" />
          Modifier
        </button>
        <button className="btn" disabled={!selected || busy} onClick={() => selected && void test(selected)}>
          <Icon name="print" />
          Imprimer un test
        </button>
        <button
          className="btn"
          disabled={!selected || busy}
          onClick={() =>
            selected &&
            void run(async () => {
              await api('POST', `/printers/${selected.id}/archive`);
              setSelectedId(null);
              setNotice(`« ${selected.name} » retirée.`);
            })
          }
        >
          <Icon name="archive" />
          Retirer
        </button>
        <span className="sep" />
        <button className="btn" onClick={() => void load()}>
          <Icon name="refresh" />
          Actualiser
        </button>
      </div>
      <div className="window-body" style={{ paddingBottom: 0 }}>
        <ErrorMessage error={error} />
        {notice && !error && <OkMessage>{notice}</OkMessage>}
      </div>
      <div className="grid-wrap" style={{ marginTop: 10 }}>
        <table className="grid">
          <thead>
            <tr>
              <th>Imprimante</th>
              <th>Adresse</th>
              <th>Papier</th>
              <th>Imprime</th>
              <th>Dernier état</th>
            </tr>
          </thead>
          <tbody>
            {printers?.length === 0 && (
              <tr>
                <td className="empty" colSpan={5}>
                  Aucune imprimante.
                </td>
              </tr>
            )}
            {printers?.map((p) => (
              <tr key={p.id} className="selectable" aria-selected={p.id === selectedId} onClick={() => setSelectedId(p.id)}>
                <td>
                  <strong>{p.name}</strong>
                </td>
                <td>
                  {p.host}:{p.port}
                </td>
                <td>{p.width === 32 ? '58 mm' : '80 mm'}</td>
                <td>{[p.printsKitchen && `Tickets ${p.stationName ?? 'de tous les postes'}`, p.printsReceipts && 'Reçus'].filter(Boolean).join(' · ') || '—'}</td>
                <td>{p.lastError ? <span className="st st-cancelled" title={p.lastError}>Injoignable</span> : p.lastOkAt ? <span className="st st-ready">Répond</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="window-body">
        <fieldset className="group">
          <legend>
            File d'impression {failed > 0 && <span className="st st-cancelled">{failed} en échec</span>}
          </legend>
          <table className="grid compact">
            <thead>
              <tr>
                <th>Heure</th>
                <th>Imprimante</th>
                <th>Document</th>
                <th>État</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td className="empty" colSpan={5}>
                    Rien d'imprimé pour l'instant.
                  </td>
                </tr>
              )}
              {jobs.slice(0, 15).map((j) => (
                <tr key={j.id}>
                  <td>{new Date(j.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{j.printerName}</td>
                  <td>
                    {PRINT_JOB_KIND_LABELS[j.kind]}
                    {j.orderNumber !== null && ` n°${j.orderNumber}`}
                  </td>
                  <td title={j.lastError ?? undefined}>
                    {j.status === 'SENT' ? <span className="st st-ready">Imprimé</span> : j.status === 'FAILED' ? <span className="st st-cancelled">Échec</span> : <span className="st st-pending">En attente</span>}
                  </td>
                  <td>
                    {j.status === 'FAILED' && (
                      <button className="btn" disabled={busy} onClick={() => void run(async () => void (await api('POST', `/print-jobs/${j.id}/retry`)))}>
                        Relancer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      </div>

      {dialog && (
        <PrinterDialog
          locationId={locationId}
          printer={dialog.printer}
          stations={stations}
          onClose={() => setDialog(null)}
          onDone={(saved) => {
            setDialog(null);
            setSelectedId(saved.id);
            setNotice(`« ${saved.name} » enregistrée. Faites un test d'impression.`);
            void load();
          }}
        />
      )}
    </>
  );
}

function PrinterDialog({ locationId, printer, stations, onDone, onClose }: { locationId: string; printer?: Printer; stations: Station[]; onDone: (p: Printer) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    name: printer?.name ?? '',
    host: printer?.host ?? '',
    port: String(printer?.port ?? 9100),
    width: printer?.width === 32 ? 32 : 48,
    stationId: printer?.stationId ?? '',
    printsKitchen: printer?.printsKitchen ?? true,
    printsReceipts: printer?.printsReceipts ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), host: form.host.trim(), port: Number(form.port), width: form.width, stationId: form.stationId || null, printsKitchen: form.printsKitchen, printsReceipts: form.printsReceipts };
      onDone(printer ? await api<Printer>('PATCH', `/printers/${printer.id}`, body) : await api<Printer>('POST', `/locations/${locationId}/printers`, body));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={printer ? `Modifier — ${printer.name}` : 'Nouvelle imprimante'}
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-primary" disabled={busy || !form.name.trim() || !form.host.trim()}>
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
            <label htmlFor="pr-name">Nom</label>
            <input id="pr-name" required maxLength={40} autoFocus placeholder="Cuisine, Bar, Caisse…" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <label htmlFor="pr-host">Adresse IP</label>
            <input id="pr-host" required maxLength={100} placeholder="192.168.1.50" value={form.host} onChange={(e) => set('host', e.target.value)} />
            <label htmlFor="pr-port">Port</label>
            <input id="pr-port" inputMode="numeric" value={form.port} onChange={(e) => set('port', e.target.value)} />
            <label htmlFor="pr-width">Papier</label>
            <select id="pr-width" value={form.width} onChange={(e) => set('width', Number(e.target.value) === 32 ? 32 : 48)}>
              <option value={48}>80 mm</option>
              <option value={32}>58 mm</option>
            </select>
            <span />
            <label className="check">
              <input type="checkbox" checked={form.printsKitchen} onChange={(e) => set('printsKitchen', e.target.checked)} />
              Imprime les tickets de préparation
            </label>
            <label htmlFor="pr-station">Poste</label>
            <select id="pr-station" disabled={!form.printsKitchen} value={form.stationId} onChange={(e) => set('stationId', e.target.value)}>
              <option value="">Tous les postes</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span />
            <label className="check">
              <input type="checkbox" checked={form.printsReceipts} onChange={(e) => set('printsReceipts', e.target.checked)} />
              Imprime les reçus de la caisse
            </label>
          </div>
        </div>
      </Dialog>
    </form>
  );
}
