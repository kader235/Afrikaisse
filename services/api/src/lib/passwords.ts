import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * scrypt de node:crypto : pas d'argon2/bcrypt natifs, qui exigent un compilateur
 * absent sur o2switch. Paramètres stockés avec le hash pour pouvoir les durcir
 * plus tard sans invalider les mots de passe existants.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const DUMMY_SALT = randomBytes(16);

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Même coût de calcul qu'un vrai compte : on ne révèle pas qu'une adresse est inconnue.
    await derive(password, DUMMY_SALT, { N, r: R, p: P });
    return false;
  }
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
