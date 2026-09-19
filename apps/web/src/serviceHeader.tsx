import type { ReactNode } from 'react';
import { LogoAfrikaisse } from './logo.tsx';
import { greeting, serviceLine } from './productPhotos.ts';

/**
 * En-tête de service (design v3) : la photo ou le logo du restaurant avec la pastille verte « ouvert »,
 * « Bonjour / Bonsoir <prénom> », la date et le service, puis les actions de la page à droite.
 */
export function ServiceHeader({
  userName,
  restaurantName,
  logo,
  detail,
  restaurantOnly = false,
  children,
}: {
  userName: string;
  restaurantName: string;
  /** Logo de l'établissement, sinon une photo de plat ; sans rien, le logo AfriKaisse. */
  logo: string | null;
  /** Complément après la date et le service (« 7 tables occupées »). */
  detail?: string | null;
  /** Affiche uniquement l'identité de l'établissement, sans salutation ni ligne de service. */
  restaurantOnly?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="svc-head">
      <div className="svc-who">
        <span className="svc-avatar" aria-hidden="true">
          {logo ? <img src={logo} alt="" /> : <LogoAfrikaisse />}
          <i className="svc-open" title="Ouvert" />
        </span>
        <div className="svc-text">
          <h1>{restaurantOnly ? restaurantName : greeting(userName)}</h1>
          {!restaurantOnly && (
            <p>
              {serviceLine()}
              {detail ? ` · ${detail}` : ''}
            </p>
          )}
        </div>
      </div>
      {children && <div className="svc-actions">{children}</div>}
    </header>
  );
}
