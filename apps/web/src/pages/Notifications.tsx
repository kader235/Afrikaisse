import { useEffect } from 'react';
import { notificationTarget, type AppNotification } from '@afrikaisse/core';
import type { NotificationCenter } from '../notifications.ts';
import { Icon } from '../ui.tsx';
import '../styles/notifications.css';

/** Panneau ouvert par la cloche : liste, non lues, tout marquer lu ; toucher une ligne ouvre l'écran concerné. */

function when(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

export function NotificationPanel({ center, onOpen, onClose }: { center: NotificationCenter; onOpen: (target: 'orders' | 'stock') => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = (n: AppNotification) => {
    center.markRead(n);
    onOpen(notificationTarget(n.kind));
  };

  return (
    <div className="panel-overlay" role="presentation" onClick={onClose}>
      <aside className="side-panel notif-panel" role="dialog" aria-modal="true" aria-label="Notifications" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="panel-who">
            <strong>Notifications</strong>
            <span>{center.unread > 0 ? `${center.unread} non lue${center.unread > 1 ? 's' : ''}` : 'Tout est lu'}</span>
          </div>
          <button className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="notif-actions">
          <button className="btn" disabled={center.unread === 0} onClick={center.markAll}>
            <Icon name="start" />
            Tout marquer lu
          </button>
        </div>
        {!center.loaded ? (
          <p className="notif-empty">Chargement…</p>
        ) : center.items.length === 0 ? (
          <p className="notif-empty">Aucune notification</p>
        ) : (
          <ul className="notif-list">
            {center.items.map((n) => (
              <li key={n.id}>
                <button className={`notif-item${n.read ? '' : ' unread'}${n.urgent ? ' urgent' : ''}`} onClick={() => open(n)}>
                  <span className="notif-dot" aria-hidden="true" />
                  <span className="notif-text">
                    <strong>{n.title}</strong>
                    {n.body && <span>{n.body}</span>}
                  </span>
                  <time className="notif-time" dateTime={new Date(n.createdAt).toISOString()}>
                    {when(n.createdAt)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
