import { useEffect, useState } from 'react';
import type { PrintQueueItem } from '@afrikaisse/core';
import { api } from './api.ts';
import { printRaw, thermalPrinterSupported } from './thermalPrinter.ts';

/**
 * Impression automatique depuis la tablette (restaurants sans PC). Quand cette tablette est
 * désignée « station d'impression », elle vide en boucle la file du serveur : elle réclame les
 * tickets déjà fabriqués (`GET print-queue`), les envoie à l'imprimante (Bluetooth / Wi-Fi / USB
 * via le plugin natif), puis accuse réception de chacun (`POST ack`).
 *
 * Une seule tablette par établissement doit être « station d'impression » : sinon plusieurs
 * tenteraient d'imprimer les mêmes tickets. Le réglage est local à l'appareil (localStorage),
 * comme « Son et notifications ».
 */

const KEY = 'afk.printStation';
const listeners = new Set<(on: boolean) => void>();

export function readPrintStation(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function savePrintStation(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* réglage valable jusqu'au prochain démarrage */
  }
  listeners.forEach((cb) => cb(on));
}

export function usePrintStation(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readPrintStation);
  useEffect(() => {
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return [on, savePrintStation];
}

/** Envoie un ticket de la file à son imprimante, selon sa liaison. */
async function sendOne(item: PrintQueueItem): Promise<void> {
  if (item.connection === 'bluetooth') {
    await printRaw({ transport: 'bluetooth', data: item.payload, address: item.host });
  } else if (item.connection === 'usb') {
    await printRaw({ transport: 'usb', data: item.payload });
  } else {
    await printRaw({ transport: 'tcp', data: item.payload, host: item.host, port: item.port });
  }
}

/** Un passage : réclame les tickets dus, les imprime, accuse réception (réussite ou échec). */
async function drainQueue(locationId: string): Promise<void> {
  const items = await api<PrintQueueItem[]>('GET', `/locations/${locationId}/print-queue`);
  for (const item of items) {
    try {
      await sendOne(item);
      await api('POST', `/print-jobs/${item.id}/ack`, { ok: true });
    } catch (err) {
      const message = String((err as { message?: unknown })?.message ?? err).slice(0, 300);
      await api('POST', `/print-jobs/${item.id}/ack`, { ok: false, error: message });
    }
  }
}

/**
 * Branche l'impression automatique tant que cette tablette est station d'impression pour
 * l'établissement ouvert. Sans effet dans le navigateur (pas d'accès natif) ou si le réglage est coupé.
 */
export function useDevicePrinting(locationId: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!thermalPrinterSupported() || !enabled || !locationId) return;
    let stopped = false;
    let running = false;
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      try {
        await drainQueue(locationId);
      } catch {
        /* serveur ou réseau momentanément coupé : on réessaiera au prochain passage */
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [locationId, enabled]);
}
