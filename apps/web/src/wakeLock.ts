import { useEffect } from 'react';

/**
 * Écran allumé pendant le service : API Wake Lock de la WebView quand elle existe (Chrome 84 et
 * plus), reprise au retour au premier plan (le système la relâche quand l'application passe
 * derrière). Sans elle (WebView 83), rien : aucune dépendance native de plus.
 */

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator && !!navigator.wakeLock;
}

export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !wakeLockSupported()) return;
    let sentinel: WakeLockSentinel | null = null;
    let pending = false;
    let stopped = false;
    const acquire = () => {
      if (stopped || pending || sentinel || document.hidden) return;
      pending = true;
      navigator.wakeLock.request('screen').then(
        (lock) => {
          pending = false;
          if (stopped) {
            void lock.release().catch(() => undefined);
            return;
          }
          sentinel = lock;
          lock.addEventListener('release', () => {
            if (sentinel === lock) sentinel = null;
          });
        },
        () => {
          pending = false;
        },
      );
    };
    const onVisible = () => !document.hidden && acquire();
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [enabled]);
}
