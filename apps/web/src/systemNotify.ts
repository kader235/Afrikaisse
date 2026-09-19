import { LocalNotifications } from '@capacitor/local-notifications';
import { isNativeApp } from './platform.ts';

/**
 * Notifications du système pour les alertes du personnel.
 *
 * Tablette : notification Android locale (@capacitor/local-notifications) sur un canal « Service »
 * d'importance haute, avec le son de notification de l'appareil ; permission demandée UNE fois
 * (Android 13 et plus). Toucher la notification ouvre l'écran concerné.
 * Navigateur : API Notifications seulement si l'utilisateur l'a autorisée lui-même depuis
 * « Son et notifications » ; jamais de demande spontanée.
 */

export type SystemPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

const CHANNEL = 'afk-service';
const ASKED_KEY = 'afk.alerts.asked';

/** Canal « Service » : le même pour les alertes locales et pour les push (push.ts, et côté serveur PUSH_CHANNEL). */
export const SERVICE_CHANNEL = {
  id: CHANNEL,
  name: 'Service (commandes, appels)',
  description: 'Nouvelles commandes, commandes prêtes, appels de table et additions',
  importance: 5 as const,
  visibility: 1 as const,
  vibration: true,
  lights: true,
  lightColor: '#065FD4',
};

let prepared = false;
let onTap: ((target: string) => void) | null = null;
/** Notification touchée pendant que l'application démarrait (aucun écran prêt à l'ouvrir). */
let pendingTap: string | null = null;
const webShown = new Map<number, Notification>();

export function setSystemTapHandler(handler: (target: string) => void): void {
  onTap = handler;
  if (pendingTap !== null) {
    const target = pendingTap;
    pendingTap = null;
    handler(target);
  }
}

/** Toucher d'une notification (locale ou push) : ouvre l'écran concerné, ou attend que l'application soit prête. */
export function dispatchSystemTap(target: string): void {
  if (onTap) onTap(target);
  else pendingTap = target;
}

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return true;
  }
}

function markAsked() {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* on ne redemandera pas pendant cette session */
  }
}

/** Canal Android, écoute du toucher, et demande de permission unique si les notifications sont activées. */
export async function prepareSystemNotifications(enabled: boolean): Promise<void> {
  if (!isNativeApp()) return;
  if (!prepared) {
    prepared = true;
    try {
      await LocalNotifications.createChannel(SERVICE_CHANNEL);
      await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const target = (action.notification.extra as { target?: unknown } | undefined)?.target;
        if (typeof target === 'string') dispatchSystemTap(target);
      });
    } catch {
      /* plugin absent (ancien APK) : le son de l'application reste */
    }
  }
  if (enabled && !alreadyAsked()) {
    markAsked();
    if ((await systemPermission()) === 'prompt') await requestSystemPermission();
  }
}

export async function systemPermission(): Promise<SystemPermission> {
  if (isNativeApp()) {
    try {
      const { display } = await LocalNotifications.checkPermissions();
      return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

/** Demande explicite (toucher de l'interrupteur, ou première ouverture sur la tablette). */
export async function requestSystemPermission(): Promise<SystemPermission> {
  if (isNativeApp()) {
    try {
      const { display } = await LocalNotifications.requestPermissions();
      return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result === 'default' ? 'prompt' : result;
  } catch {
    return 'unsupported';
  }
}

export interface SystemAlert {
  id: number;
  title: string;
  body: string | null;
  target: string;
}

/** Poste la notification si elle est autorisée ; `false` sinon (jamais de demande ici). */
export async function postSystemNotification(alert: SystemAlert): Promise<boolean> {
  if ((await systemPermission()) !== 'granted') return false;
  if (isNativeApp()) {
    try {
      await LocalNotifications.schedule({
        notifications: [{ id: alert.id, title: alert.title, body: alert.body ?? '', channelId: CHANNEL, extra: { target: alert.target }, autoCancel: true, foreground: true }],
      });
      return true;
    } catch {
      return false;
    }
  }
  try {
    const note = new Notification(alert.title, { body: alert.body ?? undefined, tag: `afk-${alert.id}` });
    note.onclick = () => {
      window.focus();
      dispatchSystemTap(alert.target);
      note.close();
    };
    webShown.set(alert.id, note);
    return true;
  } catch {
    return false;
  }
}

/** Alerte traitée : sa notification disparaît du volet. */
export function cancelSystemNotification(id: number): void {
  if (isNativeApp()) {
    LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
    return;
  }
  webShown.get(id)?.close();
  webShown.delete(id);
}
