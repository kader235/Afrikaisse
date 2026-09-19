import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import type { AppConfig } from '../config.ts';

/**
 * Envoi de notifications push Android par Firebase Cloud Messaging (API HTTP v1).
 *
 * Aucune dépendance de plus : le jeton d'accès Google est obtenu avec `jose` (déjà là pour les
 * jetons de session) à partir du fichier « compte de service » Firebase, et l'envoi est un simple
 * `fetch`. Ce fichier est un SECRET du serveur (jamais dans le dépôt, jamais dans l'APK).
 */

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string | null;
  /** Valeurs texte uniquement (contrainte FCM). */
  data: Record<string, string>;
}

/** sent : parti ; invalid : jeton mort (appli désinstallée…), à supprimer ; failed : panne passagère. */
export type PushResult = 'sent' | 'invalid' | 'failed';

export interface PushSender {
  send(message: PushMessage): Promise<PushResult>;
}

/** Canal Android créé par la tablette (systemNotify.ts) : importance haute, son et vibration. */
export const PUSH_CHANNEL = 'afk-service';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Une alerte de service qui arrive plus de 2 minutes après n'a plus d'intérêt : FCM la jette. */
const TTL = '120s';

export function parseFcmCredentials(raw: string): FcmCredentials {
  const json = JSON.parse(raw) as { project_id?: unknown; client_email?: unknown; private_key?: unknown };
  if (typeof json.project_id !== 'string' || typeof json.client_email !== 'string' || typeof json.private_key !== 'string') {
    throw new Error('Compte de service Firebase incomplet (project_id, client_email et private_key attendus).');
  }
  // Une clé collée dans un .env garde parfois ses « \n » littéraux.
  return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key.replace(/\\n/g, '\n') };
}

/** null : notifications push non configurées (le reste de l'application marche comme avant). */
export function loadFcmCredentials(config: Pick<AppConfig, 'fcmCredentials' | 'fcmCredentialsFile'>): FcmCredentials | null {
  if (config.fcmCredentials) return parseFcmCredentials(config.fcmCredentials);
  if (config.fcmCredentialsFile) return parseFcmCredentials(readFileSync(config.fcmCredentialsFile, 'utf8'));
  return null;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export function createFcmSender(credentials: FcmCredentials, options: { fetch?: typeof fetch; now?: () => number } = {}): PushSender {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: CachedToken | null = null;
  let key: Awaited<ReturnType<typeof importPKCS8>> | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.value;
    key ??= await importPKCS8(credentials.privateKey, 'RS256');
    const iat = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(credentials.clientEmail)
      .setSubject(credentials.clientEmail)
      .setAudience(TOKEN_URL)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    const res = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Jeton Google refusé (HTTP ${res.status}) : ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('Réponse Google sans access_token.');
    cached = { value: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
    return cached.value;
  }

  async function post(message: PushMessage): Promise<Response> {
    return doFetch(`https://fcm.googleapis.com/v1/projects/${credentials.projectId}/messages:send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify({
        message: {
          token: message.token,
          notification: { title: message.title, ...(message.body && { body: message.body }) },
          data: message.data,
          android: { priority: 'HIGH', ttl: TTL, notification: { channel_id: PUSH_CHANNEL, sound: 'default' } },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  }

  return {
    async send(message) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const res = await post(message);
          if (res.ok) return 'sent';
          if (res.status === 401) {
            // Jeton d'accès refusé : on en redemande un au prochain essai.
            cached = null;
            continue;
          }
          const text = await res.text();
          // Appareil qui n'existe plus : le jeton ne servira jamais. On ne supprime QUE sur ces signes précis :
          // un 400 générique peut venir d'un message mal formé, et effacerait alors des jetons valides.
          if (res.status === 404 || /UNREGISTERED|not a valid FCM registration token/i.test(text)) return 'invalid';
          if (res.status >= 500 || res.status === 429) continue;
          return 'failed';
        } catch {
          /* réseau ou délai : un second essai, puis on abandonne cette alerte */
        }
      }
      return 'failed';
    },
  };
}
