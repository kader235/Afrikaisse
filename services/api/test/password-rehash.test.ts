import { scrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { needsRehash } from '../src/lib/passwords.ts';
import { ENGINES, PASSWORD, login, registerOrg, startApp } from './helpers.ts';

/** Reproduit l'ancien format de hash (paramètres faibles p=1) pour vérifier son ré-encodage. */
async function legacyHash(password: string): Promise<string> {
  const N = 16384;
  const R = 8;
  const P = 1;
  const salt = Buffer.from('sel-ancien-de-test-16');
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, 32, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, k) => (err ? reject(err) : resolve(k))),
  );
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

describe('Ré-encodage des mots de passe', () => {
  it('needsRehash repère un format faible ou inattendu', async () => {
    expect(needsRehash(await legacyHash('x'))).toBe(true);
    expect(needsRehash('bcrypt$...')).toBe(true);
    expect(needsRehash('scrypt$16384$8$5$sel$clef')).toBe(false);
    expect(needsRehash('scrypt$131072$8$5$sel$clef')).toBe(false);
  });

  describe.each(ENGINES)('à la connexion — %s', (engine) => {
    it("remplace un ancien hash faible par le format courant, sans gêner la connexion", async () => {
      const t = await startApp(engine);
      try {
        const owner = await registerOrg(t, 'Rehash');
        // On rétrograde volontairement le hash stocké vers l'ancien format p=1.
        const legacy = await legacyHash(PASSWORD);
        await t.ctx.db.updateTable('users').set({ password_hash: legacy }).where('email', '=', owner.email).execute();

        const res = await login(t, owner.email);
        expect(res.statusCode).toBe(200);

        const after = await t.ctx.db.selectFrom('users').select('password_hash').where('email', '=', owner.email).executeTakeFirstOrThrow();
        expect(after.password_hash).not.toBe(legacy);
        expect(needsRehash(after.password_hash!)).toBe(false);

        // Le mot de passe fonctionne toujours après ré-encodage.
        expect((await login(t, owner.email)).statusCode).toBe(200);
      } finally {
        await t.close();
      }
    });
  });
});
