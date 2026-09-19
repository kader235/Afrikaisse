import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { PUSH_CHANNEL, createFcmSender, parseFcmCredentials, type FcmCredentials } from '../src/lib/fcm.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const credentials: FcmCredentials = { projectId: 'afrikaisse-test', clientEmail: 'push@afrikaisse-test.iam.gserviceaccount.com', privateKey: pem };
const message = { token: 'tok-'.padEnd(40, 'x'), title: 'Commande n°3 prête', body: 'Table T1', data: { target: 'orders' } };

interface Call {
  url: string;
  init: RequestInit;
}

/** Faux Google : un jeton d'accès, puis les réponses FCM dans l'ordre donné. */
function fakeGoogle(fcmReplies: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let fcmIndex = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
    const reply = fcmReplies[Math.min(fcmIndex, fcmReplies.length - 1)]!;
    fcmIndex += 1;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  }) as typeof fetch;
  return { calls, fetchImpl, oauthCalls: () => calls.filter((c) => c.url.includes('oauth2')).length };
}

describe('FCM — envoi de notifications push', () => {
  it('signe un JWT au nom du compte de service et poste un message Android prioritaire', async () => {
    const google = fakeGoogle([{ status: 200 }]);
    const sender = createFcmSender(credentials, { fetch: google.fetchImpl });
    expect(await sender.send(message)).toBe('sent');

    const oauth = google.calls.find((c) => c.url.includes('oauth2'))!;
    const assertion = new URLSearchParams(String(oauth.init.body)).get('assertion')!;
    const claims = decodeJwt(assertion);
    expect(claims.iss).toBe(credentials.clientEmail);
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect((claims as { scope?: string }).scope).toContain('firebase.messaging');

    const push = google.calls.find((c) => c.url.includes('fcm.googleapis.com'))!;
    expect(push.url).toBe('https://fcm.googleapis.com/v1/projects/afrikaisse-test/messages:send');
    expect((push.init.headers as Record<string, string>).authorization).toBe('Bearer ya29.test');
    const sent = JSON.parse(String(push.init.body)).message;
    expect(sent.token).toBe(message.token);
    expect(sent.notification).toEqual({ title: 'Commande n°3 prête', body: 'Table T1' });
    expect(sent.android.priority).toBe('HIGH');
    expect(sent.android.notification.channel_id).toBe(PUSH_CHANNEL);
  });

  it("garde le jeton d'accès en cache : un seul aller-retour vers Google pour plusieurs envois", async () => {
    const google = fakeGoogle([{ status: 200 }]);
    const sender = createFcmSender(credentials, { fetch: google.fetchImpl });
    await sender.send(message);
    await sender.send(message);
    expect(google.oauthCalls()).toBe(1);
  });

  it('jeton d’appareil mort (404 / UNREGISTERED) : invalid, pour le supprimer', async () => {
    const sender = createFcmSender(credentials, { fetch: fakeGoogle([{ status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }]).fetchImpl });
    expect(await sender.send(message)).toBe('invalid');
  });

  it('un 400 générique (message mal formé) ne fait PAS supprimer le jeton', async () => {
    const sender = createFcmSender(credentials, { fetch: fakeGoogle([{ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data' } } }]).fetchImpl });
    expect(await sender.send(message)).toBe('failed');
  });

  it('un 400 « not a valid FCM registration token » est un jeton mort', async () => {
    const sender = createFcmSender(credentials, { fetch: fakeGoogle([{ status: 400, body: { error: { message: 'The registration token is not a valid FCM registration token' } } }]).fetchImpl });
    expect(await sender.send(message)).toBe('invalid');
  });

  it('panne passagère (503) : un second essai, puis réussite', async () => {
    const sender = createFcmSender(credentials, { fetch: fakeGoogle([{ status: 503 }, { status: 200 }]).fetchImpl });
    expect(await sender.send(message)).toBe('sent');
  });

  it('accepte une clé collée avec des \\n littéraux', () => {
    const parsed = parseFcmCredentials(JSON.stringify({ project_id: 'p', client_email: 'e@x', private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' }));
    expect(parsed.privateKey).toContain('\n');
    expect(parsed.privateKey).not.toContain('\\n');
    expect(() => parseFcmCredentials('{"project_id":"p"}')).toThrow(/incomplet/);
  });
});
