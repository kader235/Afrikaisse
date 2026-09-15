import { contextBridge, ipcRenderer } from 'electron';

/**
 * Pont des fenêtres LOCALES de la console (attente, appairage), chargées depuis ses propres fichiers.
 * Rien n'est exposé à l'application web servie par le serveur local : elle reste une page web ordinaire.
 * Le processus principal vérifie en plus l'adresse de chaque appel (main.ts → trusted).
 */
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('afk', {
    etat: () => ipcRenderer.invoke('afk:attente'),
    surEtat: (callback: (etat: unknown) => void) => {
      ipcRenderer.on('afk:attente', (_event, etat: unknown) => callback(etat));
    },
    appairage: () => ipcRenderer.invoke('afk:appairage'),
    surActualiser: (callback: () => void) => {
      ipcRenderer.on('afk:actualiser', () => callback());
    },
    reessayer: () => ipcRenderer.invoke('afk:reessayer'),
    ouvrirJournaux: () => ipcRenderer.invoke('afk:journaux'),
    fermer: () => ipcRenderer.invoke('afk:fermer'),
  });
}
