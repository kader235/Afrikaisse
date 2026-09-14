import { useCallback, useEffect, useState } from 'react';
import type { Me, SetupStatus } from '@afrikaisse/core';
import { api } from '../api.ts';
import { ErrorMessage, Icon, OkMessage, Window } from '../ui.tsx';

export type StartTarget = 'floor' | 'menu' | 'team' | 'pos' | 'orders';

/**
 * « Bien démarrer » (§70) : ce qu'il reste à faire avant le premier service, dans l'ordre,
 * et la démonstration pour essayer AfriKaisse sans rien saisir (§71).
 */
export function StartPage({ me, onGo, onStatus }: { me: Me; onGo: (target: StartTarget) => void; onStatus: (status: SetupStatus) => void }) {
  const location = me.locations[0] ?? null;
  const has = (p: Me['permissions'][number]) => me.permissions.includes(p);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!location) return;
    try {
      const next = await api<SetupStatus>('GET', `/locations/${location.id}/setup`);
      setStatus(next);
      onStatus(next);
    } catch (err) {
      setError(err);
    }
  }, [location, onStatus]);
  useEffect(() => {
    void load();
  }, [load]);

  async function loadDemo() {
    if (!location) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<SetupStatus>('POST', `/locations/${location.id}/demo`);
      setStatus(next);
      onStatus(next);
      setNotice(`Démonstration installée : ${next.tables} tables, ${next.products} produits, postes cuisine, grill et bar. Tout se modifie ou s'archive ensuite.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  type Step = { done: boolean; title: string; text: string; action: string; target: StartTarget; visible: boolean };
  const steps: Step[] = status
    ? ([
        { done: status.tables > 0, title: 'Dessiner la salle', text: 'Zones et tables. Chaque table reçoit son QR code pour le menu client.', action: 'Plan de salle', target: 'floor', visible: has('tables.read') },
        { done: status.products > 0, title: 'Composer la carte', text: 'Catégories, produits, options, photos, et le poste (cuisine, grill, bar) de chaque plat.', action: 'Menu', target: 'menu', visible: has('menu.read') },
        { done: status.members > 1, title: "Ajouter l'équipe", text: 'Serveurs, caissiers, cuisiniers : chacun son accès, rien de plus.', action: 'Équipe', target: 'team', visible: has('users.read') },
        { done: status.cashSessions > 0, title: 'Ouvrir la caisse', text: 'Compter le fond de caisse, puis faire la première vente.', action: 'Caisse', target: 'pos', visible: has('payments.collect') },
        { done: status.orders > 0, title: 'Prendre la première commande', text: 'Depuis la caisse, la tablette du serveur ou le QR code d’une table.', action: 'Commandes', target: 'orders', visible: has('orders.read') },
      ] as Step[]).filter((s) => s.visible)
    : [];
  const done = steps.filter((s) => s.done).length;
  const empty = status !== null && status.tables === 0 && status.products === 0;

  return (
    <Window title={location ? `Bien démarrer — ${location.name}` : 'Bien démarrer'} count={status ? `${done} étape(s) sur ${steps.length}` : undefined}>
      <ErrorMessage error={error} />
      {notice && !error && <OkMessage>{notice}</OkMessage>}
      {!status && !error && <p className="muted">Chargement…</p>}

      {status && (
        <div className="start">
          <ol className="start-steps">
            {steps.map((s, i) => (
              <li key={s.target} className={s.done ? 'done' : undefined}>
                <span className="start-mark">{s.done ? '✓' : i + 1}</span>
                <div>
                  <strong>{s.title}</strong>
                  <p className="muted">{s.text}</p>
                </div>
                <button className={s.done ? 'btn' : 'btn btn-primary'} onClick={() => onGo(s.target)}>
                  {s.action}
                </button>
              </li>
            ))}
          </ol>

          {empty && has('menu.manage') && has('tables.manage') && (
            <fieldset className="group start-demo">
              <legend>Essayer avec un restaurant de démonstration</legend>
              <p>
                Installe en un geste une salle et une terrasse (10 tables avec leur QR code), une carte de 19 plats et boissons avec options, et un poste grill. Idéal pour découvrir la caisse, l'écran cuisine et le menu client
                avant de saisir votre propre carte.
              </p>
              <p className="muted">Uniquement sur un établissement vide. Tout se modifie ou s'archive ensuite.</p>
              <button className="btn btn-primary" disabled={busy} onClick={loadDemo}>
                <Icon name="add" />
                {busy ? 'Installation…' : 'Installer la démonstration'}
              </button>
            </fieldset>
          )}

          {status.complete && done === steps.length && (
            <div className="msg msg-ok">Tout est prêt. Cette page restera accessible depuis « Bien démarrer » jusqu'au prochain rechargement.</div>
          )}
        </div>
      )}
    </Window>
  );
}
