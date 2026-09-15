/** Copie produite par `cli backup` (dernière ligne JSON de sa sortie). */
export interface BackupFile {
  name: string;
  size: number;
}

export function parseBackupOutput(output: string): BackupFile | null {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as Partial<BackupFile>;
      if (typeof value.name === 'string' && value.name && typeof value.size === 'number') return { name: value.name, size: value.size };
    } catch {
      /* ligne suivante */
    }
  }
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/** Message d'erreur montré à l'utilisateur : la dernière ligne utile, jamais une pile d'appels entière. */
export function errorSummary(output: string, timedOut: boolean): string {
  if (timedOut) return 'La copie a dépassé 5 minutes : réessayez hors du coup de feu.';
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('at '))
    .pop();
  return line ? line.slice(0, 200) : 'Erreur inconnue.';
}
