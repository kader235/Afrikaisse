import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import type { AppDatabase } from '@afrikaisse/database';

/**
 * Sauvegardes du serveur local (§69). `VACUUM INTO` produit une copie cohérente d'une base
 * SQLite même pendant le service ; chaque copie est vérifiée (`integrity_check`) avant d'être
 * gardée. Rotation : les 24 plus récentes, plus la dernière de chacun des 30 derniers jours.
 * Une copie sur le même disque ne protège pas d'une panne de disque : LOCAL.md recommande une
 * copie hors du PC (clé USB, dossier réseau).
 */

export interface BackupFile {
  name: string;
  size: number;
  createdAt: number;
}

const PREFIX = 'afrikaisse-';
const pad = (n: number) => String(n).padStart(2, '0');

function stamp(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.sqlite'))
    .map((name) => {
      const s = statSync(join(dir, name));
      return { name, size: s.size, createdAt: s.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Fichiers à supprimer : au-delà des 24 plus récentes, on ne garde qu'une copie par jour, 30 jours. */
export function filesToPrune(files: BackupFile[], now: number, keepRecent = 24, keepDays = 30): string[] {
  const sorted = [...files].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set(sorted.slice(0, keepRecent).map((f) => f.name));
  const days = new Set<string>();
  for (const f of sorted) {
    if (now - f.createdAt > keepDays * 86_400_000) continue;
    const day = new Date(f.createdAt).toDateString();
    if (!days.has(day)) {
      days.add(day);
      keep.add(f.name);
    }
  }
  return sorted.filter((f) => !keep.has(f.name)).map((f) => f.name);
}

export async function backupNow(database: AppDatabase, dir: string, label = ''): Promise<BackupFile> {
  if (database.kind !== 'sqlite') throw new Error('Sauvegarde intégrée réservée au serveur local (SQLite).');
  mkdirSync(dir, { recursive: true });
  const name = `${PREFIX}${stamp(Date.now())}${label ? `-${label}` : ''}.sqlite`;
  const file = join(dir, name);
  await sql`VACUUM INTO ${sql.lit(file)}`.execute(database.db);

  // Une copie illisible est pire qu'aucune : elle donnerait une fausse assurance.
  const { DatabaseSync } = await import('node:sqlite');
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const result = copy.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (result?.integrity_check !== 'ok') throw new Error(`Copie corrompue : ${result?.integrity_check ?? 'inconnu'}`);
  } catch (err) {
    copy.close();
    unlinkSync(file);
    throw err;
  }
  copy.close();

  for (const old of filesToPrune(listBackups(dir), Date.now())) {
    try {
      unlinkSync(join(dir, old));
    } catch {
      /* fichier ouvert ailleurs : on réessaiera à la prochaine sauvegarde */
    }
  }
  const s = statSync(file);
  return { name, size: s.size, createdAt: s.mtimeMs };
}

/** Sauvegarde toutes les heures ; renvoie la fonction d'arrêt. */
export function scheduleBackups(database: AppDatabase, dir: string, onError: (err: unknown) => void, everyMs = 3_600_000): () => void {
  const timer = setInterval(() => void backupNow(database, dir).catch(onError), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
