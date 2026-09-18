import { Migrator, type Migration } from 'kysely';
import type { AppDatabase } from './dialects.ts';
import { columnKit } from './columns.ts';
import { foundation } from './migrations/0001_foundation.ts';
import { floor } from './migrations/0002_floor.ts';
import { menu } from './migrations/0003_menu.ts';
import { orders } from './migrations/0004_orders.ts';
import { pos } from './migrations/0005_pos.ts';
import { kitchen } from './migrations/0006_kitchen.ts';
import { stock } from './migrations/0007_stock.ts';
import { printing } from './migrations/0008_printing.ts';
import { sync } from './migrations/0009_sync.ts';
import { plans } from './migrations/0010_plans.ts';
import { pricing } from './migrations/0011_pricing.ts';
import { notifications } from './migrations/0012_notifications.ts';
import { platform } from './migrations/0013_platform.ts';
import { client } from './migrations/0014_client.ts';
import { onboarding } from './migrations/0015_onboarding.ts';
import { recovery } from './migrations/0016_recovery.ts';
import { announcements } from './migrations/0017_announcements.ts';
import { zoneColors } from './migrations/0018_zone_colors.ts';
import { menuTheme } from './migrations/0019_menu_theme.ts';
import { locationSlogan } from './migrations/0020_location_slogan.ts';
import { pushTokens } from './migrations/0021_push_tokens.ts';

/**
 * Les migrations sont embarquées dans le code (pas lues sur disque) : l'API est
 * livrée en un seul fichier sur o2switch et dans l'installateur Windows.
 * Ne jamais modifier une migration publiée : en ajouter une nouvelle.
 */
function migrations(app: AppDatabase): Record<string, Migration> {
  const c = columnKit(app.kind);
  return {
    '0001_foundation': foundation(c),
    '0002_floor': floor(c),
    '0003_menu': menu(c),
    '0004_orders': orders(c),
    '0005_pos': pos(c),
    '0006_kitchen': kitchen(c),
    '0007_stock': stock(c),
    '0008_printing': printing(c),
    '0009_sync': sync(c),
    '0010_plans': plans(c),
    '0011_pricing': pricing(c),
    '0012_notifications': notifications(c),
    '0013_platform': platform(c),
    '0014_client': client(c),
    '0015_onboarding': onboarding(c),
    '0016_recovery': recovery(c),
    '0017_announcements': announcements(c),
    '0018_zone_colors': zoneColors(c),
    '0019_menu_theme': menuTheme(c),
    '0020_location_slogan': locationSlogan(c),
    '0021_push_tokens': pushTokens(c),
  };
}

export async function migrateToLatest(app: AppDatabase): Promise<string[]> {
  const migrator = new Migrator({
    db: app.db,
    provider: { getMigrations: async () => migrations(app) },
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
