import { describe, expect, it } from 'vitest';
import {
  HybridClock,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  canManageRole,
  isUuid,
  parseHlc,
  registerSchema,
  roleCan,
  uuidv7,
} from '../src/index.ts';

describe('uuidv7', () => {
  it('produit un UUID v7 valide', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('se trie dans l’ordre de création', () => {
    const ids = [1_700_000_000_000, 1_700_000_000_001, 1_800_000_000_000].map((t) => uuidv7(t));
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('HybridClock', () => {
  it('reste croissante même si l’horloge du PC recule', () => {
    let wall = 1_000_000;
    const clock = new HybridClock('node-a', () => wall);
    const a = clock.now();
    wall = 500_000; // l'utilisateur remet le PC à l'heure… en arrière
    const b = clock.now();
    const c = clock.now();
    expect(a < b && b < c).toBe(true);
  });

  it('dépasse un horodatage reçu d’un nœud en avance', () => {
    const local = new HybridClock('node-a', () => 1_000);
    const remote = new HybridClock('node-b', () => 9_000);
    const received = remote.now();
    local.receive(received);
    const next = local.now();
    expect(parseHlc(next).wallMs).toBeGreaterThanOrEqual(9_000);
    expect(next.slice(0, 21) > received.slice(0, 21)).toBe(true);
  });
});

describe('RBAC', () => {
  it('le propriétaire a toutes les permissions, l’admin tout sauf l’abonnement', () => {
    expect(ROLE_PERMISSIONS.OWNER).toEqual([...PERMISSIONS]);
    expect(roleCan('ADMIN', 'subscription.manage')).toBe(false);
    expect(roleCan('ADMIN', 'users.manage')).toBe(true);
  });

  it('le personnel de salle et de cuisine ne gère ni l’équipe ni l’audit', () => {
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'BAR', 'STOCK_MANAGER'] as const) {
      expect(roleCan(role, 'users.manage')).toBe(false);
      expect(roleCan(role, 'audit.read')).toBe(false);
    }
    expect(roleCan('KITCHEN', 'kitchen.use')).toBe(true);
    expect(roleCan('WAITER', 'payments.collect')).toBe(false);
  });

  it('on n’attribue qu’un rôle strictement inférieur (sauf propriétaire)', () => {
    expect(canManageRole('OWNER', 'OWNER')).toBe(true);
    expect(canManageRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageRole('ADMIN', 'MANAGER')).toBe(true);
    expect(canManageRole('MANAGER', 'ADMIN')).toBe(false);
    expect(canManageRole('MANAGER', 'CASHIER')).toBe(true);
    expect(canManageRole('CASHIER', 'WAITER')).toBe(false);
  });
});

describe('Contrats', () => {
  it('normalise l’e-mail et applique les valeurs par défaut du marché', () => {
    const parsed = registerSchema.parse({
      organizationName: 'Groupe ABC',
      locationName: 'Centre',
      ownerName: 'Awa',
      email: '  Awa@Exemple.TD ',
      password: 'motdepasse-solide',
    });
    expect(parsed.email).toBe('awa@exemple.td');
    expect(parsed.currency).toBe('XAF');
    expect(parsed.locationType).toBe('RESTAURANT');
  });
});
