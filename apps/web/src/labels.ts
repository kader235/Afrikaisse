import type { LocationType, OperatingMode, Role, TableShape } from '@afrikaisse/core';
import type { Language } from './i18n.tsx';

export const ROLE_LABELS: Record<Language, Record<Role, string>> = {
  fr: {
    OWNER: 'Propriétaire',
    ADMIN: 'Administrateur',
    MANAGER: 'Gérant',
    CASHIER: 'Caissier',
    WAITER: 'Serveur',
    KITCHEN: 'Cuisine',
    BAR: 'Bar',
    STOCK_MANAGER: 'Magasinier',
  },
  en: {
    OWNER: 'Owner',
    ADMIN: 'Administrator',
    MANAGER: 'Manager',
    CASHIER: 'Cashier',
    WAITER: 'Waiter',
    KITCHEN: 'Kitchen',
    BAR: 'Bar',
    STOCK_MANAGER: 'Stock manager',
  },
  ar: {
    OWNER: 'المالك',
    ADMIN: 'مدير النظام',
    MANAGER: 'المدير',
    CASHIER: 'أمين الصندوق',
    WAITER: 'النادل',
    KITCHEN: 'المطبخ',
    BAR: 'البار',
    STOCK_MANAGER: 'أمين المخزن',
  },
};

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  RESTAURANT: 'Restaurant',
  HOTEL: 'Hôtel',
  CAFE: 'Café',
  BAR: 'Bar',
  LOUNGE: 'Lounge',
  FAST_FOOD: 'Fast-food',
  BAKERY: 'Boulangerie',
  PASTRY: 'Pâtisserie',
  FOOD_COURT: 'Food court',
};

/** Pays proposés à l'inscription : fuseau et devise préremplis, modifiables. */
export const COUNTRIES = [
  { code: 'TD', name: 'Tchad', timezone: 'Africa/Ndjamena', currency: 'XAF' },
  { code: 'CM', name: 'Cameroun', timezone: 'Africa/Douala', currency: 'XAF' },
  { code: 'CF', name: 'Centrafrique', timezone: 'Africa/Bangui', currency: 'XAF' },
  { code: 'CG', name: 'Congo', timezone: 'Africa/Brazzaville', currency: 'XAF' },
  { code: 'GA', name: 'Gabon', timezone: 'Africa/Libreville', currency: 'XAF' },
  { code: 'GQ', name: 'Guinée équatoriale', timezone: 'Africa/Malabo', currency: 'XAF' },
  { code: 'SN', name: 'Sénégal', timezone: 'Africa/Dakar', currency: 'XOF' },
  { code: 'CI', name: "Côte d'Ivoire", timezone: 'Africa/Abidjan', currency: 'XOF' },
  { code: 'BJ', name: 'Bénin', timezone: 'Africa/Porto-Novo', currency: 'XOF' },
  { code: 'BF', name: 'Burkina Faso', timezone: 'Africa/Ouagadougou', currency: 'XOF' },
  { code: 'ML', name: 'Mali', timezone: 'Africa/Bamako', currency: 'XOF' },
  { code: 'NE', name: 'Niger', timezone: 'Africa/Niamey', currency: 'XOF' },
  { code: 'TG', name: 'Togo', timezone: 'Africa/Lome', currency: 'XOF' },
  { code: 'GN', name: 'Guinée', timezone: 'Africa/Conakry', currency: 'GNF' },
  { code: 'CD', name: 'RD Congo', timezone: 'Africa/Kinshasa', currency: 'CDF' },
  { code: 'RW', name: 'Rwanda', timezone: 'Africa/Kigali', currency: 'RWF' },
  { code: 'NG', name: 'Nigeria', timezone: 'Africa/Lagos', currency: 'NGN' },
  { code: 'GH', name: 'Ghana', timezone: 'Africa/Accra', currency: 'GHS' },
  { code: 'MA', name: 'Maroc', timezone: 'Africa/Casablanca', currency: 'MAD' },
  { code: 'FR', name: 'France', timezone: 'Europe/Paris', currency: 'EUR' },
] as const;

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'tenant.registered': 'Organisation créée',
  'tenant.renamed': 'Organisation renommée',
  'auth.login': 'Connexion',
  'auth.switch_tenant': "Changement d'organisation",
  'auth.refresh_reuse': 'Session révoquée (jeton réutilisé)',
  'auth.password_changed': 'Mot de passe changé',
  'auth.password_change_failed': 'Échec de changement de mot de passe',
  'team.member_added': 'Membre ajouté',
  'team.member_updated': 'Membre modifié',
  'team.password_reset': 'Mot de passe redéfini',
  'platform.tenant_suspended': 'Organisation suspendue par AfriKaisse',
  'platform.tenant_reactivated': 'Organisation réactivée par AfriKaisse',
  'location.created': 'Établissement créé',
  'location.updated': 'Établissement modifié',
  'location.mode_changed': "Mode d'exploitation changé",
  'location.archived': 'Établissement archivé',
  'location.restored': 'Établissement réactivé',
  'floor.zone_created': 'Zone créée',
  'floor.zone_updated': 'Zone modifiée',
  'floor.zone_archived': 'Zone archivée',
  'floor.table_created': 'Table ajoutée',
  'floor.table_updated': 'Table modifiée',
  'floor.table_archived': 'Table archivée',
  'floor.layout_saved': 'Plan de salle enregistré',
  'floor.qr_regenerated': 'QR de table régénéré',
  'menu.category_created': 'Catégorie créée',
  'menu.category_updated': 'Catégorie modifiée',
  'menu.category_archived': 'Catégorie archivée',
  'menu.categories_reordered': 'Catégories réordonnées',
  'menu.products_reordered': 'Produits réordonnés',
  'menu.product_created': 'Produit créé',
  'menu.product_updated': 'Produit modifié',
  'menu.price_changed': 'Prix modifié',
  'menu.product_archived': 'Produit archivé',
  'menu.product_sold_out': 'Produit marqué épuisé',
  'menu.product_available': 'Produit de nouveau disponible',
  'menu.modifier_group_created': "Groupe d'options créé",
  'menu.modifier_group_updated': "Groupe d'options modifié",
  'menu.modifier_group_archived': "Groupe d'options archivé",
  'menu.modifier_sold_out': 'Option marquée épuisée',
  'menu.modifier_available': 'Option de nouveau disponible',
  'menu.photo_uploaded': 'Photo ajoutée',
  'order.qr_placed': 'Commande reçue par QR',
  'order.rejected': 'Commande QR refusée',
  'order.cancelled': 'Commande annulée',
  'table.freed': 'Table libérée',
  'setup.step_skipped': 'Mise en route : étape passée',
  'setup.tables_generated': 'Tables créées en série',
  'setup.test_order': 'Commande de test envoyée',
  'setup.test_completed': 'Test de mise en route réussi',
  'setup.completed': 'Mise en route terminée',
  'demo.loaded': 'Démonstration installée',
  'demo.tenant_created': 'Organisation de démonstration créée',
};

export const OPERATING_MODE_LABELS: Record<OperatingMode, string> = {
  CLOUD: 'Cloud (sans serveur local)',
  HYBRID: 'Serveur local (continue sans Internet)',
};

export const SHAPE_LABELS: Record<TableShape, string> = {
  SQUARE: 'Carrée',
  ROUND: 'Ronde',
  RECT: 'Rectangulaire',
};

export const TIMEZONES: string[] = [...new Set(COUNTRIES.map((c) => c.timezone as string))];

/** 00:00 à 12:00 par demi-heure : heure de bascule de la journée d'exploitation. */
export const CUTOFF_OPTIONS = Array.from({ length: 25 }, (_, i) => i * 30);

export function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export const ORDER_SOURCE_LABELS: Record<'QR' | 'POS' | 'WAITER', string> = {
  QR: 'QR client',
  POS: 'Caisse',
  WAITER: 'Serveur',
};

/** Où va la commande : « Table T3 », « À emporter · Awa », « Comptoir » (sur place sans table). */
export function orderPlace(o: { tableLabel: string | null; serviceType: string; customerName: string | null }): string {
  const base = o.tableLabel ? `Table ${o.tableLabel}` : o.serviceType === 'TAKEAWAY' ? 'À emporter' : 'Comptoir';
  return o.customerName ? `${base} · ${o.customerName}` : base;
}

/** « à l'instant », « il y a 4 min », « il y a 1 h 05 ». */
export function sinceText(ms: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function formatDateTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}
