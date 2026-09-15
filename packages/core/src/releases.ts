import { z } from 'zod';

/**
 * Mises à jour du serveur local (§73). Le Cloud publie une annonce signée (Ed25519) ; le serveur
 * local la vérifie avec la clé publique embarquée à la construction, compare les versions et
 * affiche le lien. Rien ne s'installe tout seul : l'installateur reste un geste humain.
 */

export const RELEASE_CHANNELS = ['stable', 'beta'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function parseSemver(version: string): Semver | null {
  const m = SEMVER.exec(version.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split('.') : [] };
}

/**
 * -1, 0 ou 1 selon semver 2.0 : une pré-version (`1.2.0-beta.1`) précède la version (`1.2.0`),
 * les métadonnées de construction (`+abc`) sont ignorées. Lève une erreur sur une version illisible.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`Version illisible : ${!x ? a : b}`);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  if (x.prerelease.length === 0 || y.prerelease.length === 0) {
    if (x.prerelease.length === y.prerelease.length) return 0;
    return x.prerelease.length === 0 ? 1 : -1;
  }
  const n = Math.max(x.prerelease.length, y.prerelease.length);
  for (let i = 0; i < n; i++) {
    const p = x.prerelease[i];
    const q = y.prerelease[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export const releaseManifestSchema = z.object({
  channel: z.enum(RELEASE_CHANNELS),
  version: z.string().max(40).refine((v) => parseSemver(v) !== null, 'Version attendue au format 1.2.3'),
  releasedAt: z.number().int().positive(),
  notes: z.string().max(4000),
  downloadUrl: z.url().refine((u) => u.startsWith('https://'), 'Lien de téléchargement en https:// uniquement'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'Empreinte SHA-256 attendue : 64 caractères hexadécimaux en minuscules'),
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const signedReleaseSchema = releaseManifestSchema.extend({ signature: z.string().min(80).max(200) });
export type SignedRelease = z.infer<typeof signedReleaseSchema>;

/** Octets signés : liste ordonnée et versionnée, jamais l'ordre des clés d'un objet JSON. */
export function releaseSigningPayload(m: ReleaseManifest): string {
  return JSON.stringify(['afrikaisse-release-v1', m.channel, m.version, m.releasedAt, m.notes, m.downloadUrl, m.sha256]);
}

export const updateStatusSchema = z.object({
  /** Serveur local avec une clé de vérification embarquée. */
  enabled: z.boolean(),
  currentVersion: z.string(),
  channel: z.enum(RELEASE_CHANNELS),
  /** Dernière annonce dont la signature a été vérifiée. */
  latest: releaseManifestSchema.nullable(),
  updateAvailable: z.boolean(),
  lastCheckAt: z.number().nullable(),
  lastError: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof updateStatusSchema>;
