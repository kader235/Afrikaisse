import { useEffect, useState } from 'react';
import { catalogueSchema, type Catalogue } from '@afrikaisse/core';
import { UserFacingError } from '../api.ts';
import { Dialog, ErrorMessage } from '../ui.tsx';

/** Crédits des photos du catalogue : sous licence libre, l'auteur et la licence doivent rester consultables. */
export function PhotoCredits({ onClose }: { onClose: () => void }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    fetch('/catalogue/catalogue.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (json) => setCatalogue(catalogueSchema.parse(json)),
        () => setError(new UserFacingError('Le catalogue de plats est introuvable sur cet appareil.')),
      );
  }, []);

  const credited = catalogue?.dishes.filter((d) => d.image && d.credit) ?? [];

  return (
    <Dialog
      wide
      title="Crédits des photos"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <div className="dialog-body">
        <ErrorMessage error={error} />
        <p className="muted" style={{ marginBottom: 12 }}>
          Les photos du catalogue de plats viennent de Wikimedia Commons, sous licence libre. Merci à leurs auteurs.
        </p>
        {catalogue && credited.length === 0 && <p className="muted">Aucune photo créditée pour le moment.</p>}
        <ul className="credits-list">
          {credited.map((d) => (
            <li key={d.id}>
              <img src={`/catalogue/images/${d.image}`} alt="" loading="lazy" />
              <div>
                <strong>{d.name}</strong>
                <span>
                  {d.credit!.author} · {d.credit!.license}
                </span>
                <span className="credits-source">{d.credit!.source}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
