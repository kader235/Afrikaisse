import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api.ts';
import { isNativeApp } from './platform.ts';
import { SERVICE_CHANNEL, dispatchSystemTap } from './systemNotify.ts';

/**
 * Notifications push (Firebase) : la tablette reçoit les alertes du service même quand l'application
 * est fermée. Sans elles, les alertes n'existent que tant que l'application tourne (interrogation
 * régulière du serveur, alerts.tsx).
 *
 * Application ouverte, rien ne s'affiche en double : Android ne montre pas un push reçu au premier
 * plan, et alerts.tsx signale déjà l'événement (son, bandeau, notification locale).
 *
 * Le plugin n'est appelé que si l'APK a été construit avec google-services.json (__AFK_PUSH__) :
 * sans configuration Firebase, le plugin fait planter l'application au lieu de renvoyer une erreur.
 */

const RETRY_MS = [5_000, 30_000, 120_000];

let listening = false;
let token: string | null = null;
let location: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

export function pushSupported(): boolean {
  return isNativeApp() && typeof __AFK_PUSH__ !== 'undefined' && __AFK_PUSH__;
}

/** Envoie le jeton au serveur ; en cas de coupure, réessaie quelques fois (l'application n'a pas à le savoir). */
async function sendToken(attempt = 0): Promise<void> {
  clearTimeout(retryTimer);
  if (!token || !location) return;
  try {
    await api('POST', `/locations/${location}/push-tokens`, { token });
  } catch {
    const delay = RETRY_MS[attempt];
    if (delay !== undefined) retryTimer = setTimeout(() => void sendToken(attempt + 1), delay);
  }
}

async function listen(): Promise<void> {
  if (listening) return;
  listening = true;
  await PushNotifications.addListener('registration', (registered) => {
    token = registered.value;
    void sendToken();
  });
  // Pas de jeton (Google Play Services absents…) : les alertes restent celles de l'application ouverte.
  await PushNotifications.addListener('registrationError', () => undefined);
  // Toucher le push ouvre l'écran concerné (même chemin que les notifications locales).
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const target = (action.notification.data as { target?: unknown } | undefined)?.target;
    if (typeof target === 'string') dispatchSystemTap(target);
  });
}

/** Demande la permission si besoin, crée le canal, obtient le jeton et le donne au serveur. */
export async function enablePush(locationId: string): Promise<void> {
  if (!pushSupported()) return;
  location = locationId;
  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;
    await listen();
    // Le push doit arriver sur le canal d'importance haute même si l'application n'a pas encore créé le sien.
    await PushNotifications.createChannel(SERVICE_CHANNEL);
    if (token) await sendToken();
    else await PushNotifications.register();
  } catch {
    /* Firebase indisponible : on n'empêche jamais l'application de servir */
  }
}

/**
 * Déconnexion ou notifications coupées : le serveur n'envoie plus rien à cette tablette, et son jeton
 * est détruit (le compte suivant qui se connectera en aura un neuf). À appeler AVANT la fin de session.
 */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  clearTimeout(retryTimer);
  const old = token;
  token = null;
  try {
    if (old) await api('POST', '/push-tokens/remove', { token: old });
  } catch {
    /* le serveur supprimera de lui-même un jeton mort au prochain envoi */
  }
  try {
    await PushNotifications.unregister();
  } catch {
    /* rien à détruire */
  }
}

/** Branche le push tant que l'utilisateur est concerné par les alertes et ne les a pas coupées. */
export function usePushRegistration(locationId: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!pushSupported() || !locationId) return;
    if (enabled) void enablePush(locationId);
    else void disablePush();
  }, [locationId, enabled]);
}
