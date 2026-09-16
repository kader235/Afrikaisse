import type { ReactNode } from 'react';
import { greeting, initialsOf, serviceLine } from './productPhotos.ts';

/**
 * En-tête de service (design v3) : la photo ou le logo du restaurant avec la pastille verte « ouvert »,
 * « Bonjour / Bonsoir <prénom> », la date et le service, puis les actions de la page à droite.
 */
export function ServiceHeader({
  userName,
  restaurantName,
  logo,
  detail,
  children,
}: {
  userName: string;
  restaurantName: string;
  /** Logo de l'établissement, sinon une photo de plat ; sans rien, les initiales du restaurant. */
  logo: string | null;
  /** Complément après la date et le service (« 7 tables occupées »). */
  detail?: string | null;
  children?: ReactNode;
}) {
  return (
    <header className="svc-head">
      <div className="svc-who">
        <span className="svc-avatar" aria-hidden="true">
          {logo ? <img src={logo} alt="" /> : <b>{initialsOf(restaurantName) || 'AK'}</b>}
          <i className="svc-open" title="Ouvert" />
        </span>
        <div className="svc-text">
          <h1>{greeting(userName)}</h1>
          <p>
            {serviceLine()}
            {detail ? ` · ${detail}` : ''}
          </p>
        </div>
      </div>
      {children && <div className="svc-actions">{children}</div>}
    </header>
  );
}
