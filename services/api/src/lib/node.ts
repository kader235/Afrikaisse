import { randomBytes } from 'node:crypto';
import { uuidv7 } from '@afrikaisse/core';
import type { Db } from '../context.ts';
import type { Profile } from '../config.ts';

/**
 * Identité persistante du nœud. Sûr en concurrence : plusieurs processus
 * Passenger peuvent démarrer ensemble sur la même base, un seul gagne.
 */
async function getOrCreate(db: Db, key: string, make: () => string): Promise<string> {
  await db
    .insertInto('node_state')
    .values({ key, value: make() })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
  const row = await db.selectFrom('node_state').select('value').where('key', '=', key).executeTakeFirstOrThrow();
  return row.value;
}

export async function initNode(db: Db, profile: Profile, now: number) {
  const nodeId = await getOrCreate(db, 'node_id', () => uuidv7());
  const jwtSecret = await getOrCreate(db, 'jwt_secret', () => randomBytes(48).toString('base64url'));
  await db
    .insertInto('devices')
    .values({
      id: nodeId,
      tenant_id: null,
      location_id: null,
      kind: profile === 'cloud' ? 'CLOUD' : 'LOCAL_SERVER',
      name: profile === 'cloud' ? 'AfriKaisse Cloud' : 'AfriKaisse Local',
      status: 'ACTIVE',
      last_seen_at: now,
      created_at: now,
      updated_at: now,
      secret_hash: null,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  return { nodeId, jwtSecret };
}
