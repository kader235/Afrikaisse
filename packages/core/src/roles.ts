/**
 * RBAC. Les rôles sont fixes (le métier d'un restaurant ne change pas d'un
 * client à l'autre) ; la matrice vit dans le code, versionnée et testée, et
 * s'applique à l'identique dans le Cloud et sur le serveur local hors ligne.
 */
export const ROLES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'WAITER',
  'KITCHEN',
  'BAR',
  'STOCK_MANAGER',
] as const;
export type Role = (typeof ROLES)[number];

/** SUPER_ADMIN n'est pas un rôle de restaurant : c'est un drapeau de plateforme. */
export const PLATFORM_ROLE = 'SUPER_ADMIN' as const;

export const PERMISSIONS = [
  'tenant.read',
  'tenant.update',
  'location.read',
  'location.manage',
  'users.read',
  'users.manage',
  'audit.read',
  'settings.manage',
  'subscription.manage',
  'menu.read',
  'menu.manage',
  /** Marquer un produit ou une option « épuisé » pendant le service. */
  'menu.availability',
  'tables.read',
  'tables.manage',
  'orders.read',
  'orders.create',
  'orders.cancel',
  'orders.discount',
  'pos.use',
  'payments.collect',
  'payments.refund',
  'kitchen.use',
  'bar.use',
  'inventory.read',
  'inventory.manage',
  'reports.read',
  'devices.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((p) => p !== 'subscription.manage'),
  MANAGER: [
    'tenant.read',
    'location.read',
    'users.read',
    'users.manage',
    'audit.read',
    'menu.read',
    'menu.manage',
    'menu.availability',
    'tables.read',
    'tables.manage',
    'orders.read',
    'orders.create',
    'orders.cancel',
    'orders.discount',
    'pos.use',
    'payments.collect',
    'payments.refund',
    'kitchen.use',
    'bar.use',
    'inventory.read',
    'inventory.manage',
    'reports.read',
    'devices.manage',
  ],
  CASHIER: [
    'tenant.read',
    'location.read',
    'menu.read',
    'menu.availability',
    'tables.read',
    'orders.read',
    'orders.create',
    'pos.use',
    'payments.collect',
  ],
  WAITER: ['tenant.read', 'location.read', 'menu.read', 'tables.read', 'orders.read', 'orders.create'],
  KITCHEN: ['tenant.read', 'location.read', 'menu.read', 'menu.availability', 'orders.read', 'kitchen.use'],
  BAR: ['tenant.read', 'location.read', 'menu.read', 'menu.availability', 'orders.read', 'bar.use'],
  STOCK_MANAGER: ['tenant.read', 'location.read', 'menu.read', 'inventory.read', 'inventory.manage'],
};

export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Rang hiérarchique : on ne peut attribuer, modifier ou désactiver qu'un rôle
 * strictement inférieur au sien (le propriétaire peut tout, y compris nommer
 * un autre propriétaire).
 */
const RANK: Record<Role, number> = {
  OWNER: 100,
  ADMIN: 80,
  MANAGER: 60,
  CASHIER: 20,
  WAITER: 20,
  KITCHEN: 20,
  BAR: 20,
  STOCK_MANAGER: 20,
};

export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === 'OWNER') return true;
  return RANK[actor] > RANK[target];
}
