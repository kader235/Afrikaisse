import type { Kysely } from 'kysely';
import type { ColumnKit } from '../columns.ts';

/**
 * Impression depuis la tablette (restaurants sans PC). Deux axes ajoutés à chaque imprimante :
 *
 * - `connection` : `network` (ESC/POS en TCP 9100, comme avant) ou `bluetooth` (l'octet part
 *   en Bluetooth depuis l'appareil ; `host` porte alors l'adresse de l'imprimante appairée).
 * - `driver` : `server` (le serveur local vide la file, comme avant) ou `device` (une tablette
 *   vient chercher les tickets déjà fabriqués et les envoie elle-même — seul mode possible sans PC).
 *
 * Valeurs par défaut = comportement d'avant : les imprimantes réseau existantes restent pilotées
 * par le serveur, rien à migrer. Texte avec valeur par défaut : identique en SQLite et PostgreSQL 9.6.
 */
export function devicePrinting(_c: ColumnKit) {
  return {
    async up(db: Kysely<any>) {
      await db.schema.alterTable('printers').addColumn('connection', 'text', (col) => col.notNull().defaultTo('network')).execute();
      await db.schema.alterTable('printers').addColumn('driver', 'text', (col) => col.notNull().defaultTo('server')).execute();
    },

    async down(db: Kysely<any>) {
      await db.schema.alterTable('printers').dropColumn('driver').execute();
      await db.schema.alterTable('printers').dropColumn('connection').execute();
    },
  };
}
