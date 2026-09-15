import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { releaseSigningPayload, type ReleaseManifest, type SignedRelease } from '@afrikaisse/core';

/**
 * Signature des annonces de version (§73), Ed25519 de `node:crypto`.
 * - Clé privée : jamais dans le dépôt ni dans le serveur web ; lue dans `AFK_RELEASE_PRIVATE_KEY`
 *   par la seule commande `cli release-sign` / `release-publish`.
 * - Clé publique : embarquée à la construction (`AFK_RELEASE_PUBLIC_KEY` lu par build.mjs).
 * Formats : DER en base64, SPKI pour la publique (« MCowBQYDK2VwAyEA… »), PKCS#8 pour la privée.
 */

declare const __AFK_RELEASE_PUBLIC_KEY__: string | undefined;
export const EMBEDDED_RELEASE_PUBLIC_KEY = typeof __AFK_RELEASE_PUBLIC_KEY__ === 'string' ? __AFK_RELEASE_PUBLIC_KEY__ : '';

function ed25519(key: KeyObject): KeyObject {
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Clé Ed25519 attendue.');
  return key;
}

export function releasePublicKey(base64: string): KeyObject {
  return ed25519(createPublicKey({ key: Buffer.from(base64.trim(), 'base64'), format: 'der', type: 'spki' }));
}

export function releasePrivateKey(base64: string): KeyObject {
  return ed25519(createPrivateKey({ key: Buffer.from(base64.trim(), 'base64'), format: 'der', type: 'pkcs8' }));
}

export function generateReleaseKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/** Clé publique correspondant à une clé privée (vérification avant publication). */
export function publicKeyOf(privateKeyBase64: string): string {
  return createPublicKey(releasePrivateKey(privateKeyBase64)).export({ format: 'der', type: 'spki' }).toString('base64');
}

export function signRelease(manifest: ReleaseManifest, privateKeyBase64: string): SignedRelease {
  const signature = sign(null, Buffer.from(releaseSigningPayload(manifest), 'utf8'), releasePrivateKey(privateKeyBase64)).toString('base64');
  const { channel, version, releasedAt, notes, downloadUrl, sha256 } = manifest;
  return { channel, version, releasedAt, notes, downloadUrl, sha256, signature };
}

/** Vrai seulement si la signature couvre exactement ces champs et vient de cette clé. Ne lève jamais. */
export function verifyRelease(release: SignedRelease, publicKeyBase64: string): boolean {
  try {
    const { signature, ...manifest } = release;
    return verify(null, Buffer.from(releaseSigningPayload(manifest), 'utf8'), releasePublicKey(publicKeyBase64), Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
