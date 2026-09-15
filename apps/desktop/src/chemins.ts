import { win32 } from 'node:path';

/** Programme AfriKaisse installé, vu depuis la console. */
export interface Install {
  /** Dossier du programme (`C:\Program Files\AfriKaisse`), null si inconnu (console lancée hors installation). */
  app: string | null;
  nodeExe: string | null;
  /** Lanceur navigateur, repli quand la tâche planifiée est absente ou refusée. */
  launcher: string | null;
  /** Outil d'administration (`cli backup`). */
  cli: string | null;
}

/**
 * La console est livrée dans `<programme>\console\AfriKaisse.exe`. `AFK_APP_DIR` la pointe ailleurs pour
 * les essais (par exemple `infrastructure\windows\charge`) ; hors installation et sans variable, la console
 * sait seulement se connecter à un serveur déjà lancé.
 */
export function resolveInstall(execPath: string, env: Record<string, string | undefined>, isPackaged: boolean): Install {
  const app = env.AFK_APP_DIR ? win32.resolve(env.AFK_APP_DIR) : isPackaged ? win32.dirname(win32.dirname(execPath)) : null;
  if (!app) return { app: null, nodeExe: null, launcher: null, cli: null };
  return {
    app,
    nodeExe: win32.join(app, 'runtime', 'node', 'node.exe'),
    launcher: win32.join(app, 'lanceur', 'demarrer.cjs'),
    cli: win32.join(app, 'app', 'cli.cjs'),
  };
}
