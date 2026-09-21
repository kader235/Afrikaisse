import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PrintQueueItem } from '@afrikaisse/core';

// La boucle d'impression appelle le plugin natif et l'API : on les remplace par des espions
// pour vérifier, sans imprimante ni serveur, que chaque ticket part sur la bonne liaison et
// que l'accusé de réception est correct (réussite comme échec).
vi.mock('../src/thermalPrinter.ts', () => ({ thermalPrinterSupported: () => true, printRaw: vi.fn() }));
vi.mock('../src/api.ts', () => ({ api: vi.fn() }));

import { drainQueue } from '../src/devicePrinting.ts';
import { printRaw } from '../src/thermalPrinter.ts';
import { api } from '../src/api.ts';

const printRawMock = printRaw as unknown as Mock;
const apiMock = api as unknown as Mock;

function item(over: Partial<PrintQueueItem>): PrintQueueItem {
  return { id: 'j', printerId: 'p', printerName: 'Imp', connection: 'network', host: '192.168.1.50', port: 9100, width: 48, kind: 'RECEIPT', payload: 'GxtA', ...over };
}

/** Fait répondre l'API : la file au GET, rien aux accusés (POST). */
function queue(items: PrintQueueItem[]) {
  apiMock.mockImplementation((method: string) => (method === 'GET' ? Promise.resolve(items) : Promise.resolve(undefined)));
}
/** Les accusés de réception envoyés : [jobId, corps]. */
function acks() {
  return apiMock.mock.calls.filter((c) => c[0] === 'POST').map((c) => [c[1], c[2]]);
}

describe('Boucle d’impression tablette', () => {
  beforeEach(() => {
    printRawMock.mockReset();
    printRawMock.mockResolvedValue({ ok: true });
    apiMock.mockReset();
  });

  it('envoie chaque ticket sur la bonne liaison et accuse réception', async () => {
    queue([
      item({ id: 'bt', connection: 'bluetooth', host: 'DC:0D:30:AA:BB:CC', payload: 'Qk8x' }),
      item({ id: 'net', connection: 'network', host: '10.0.0.9', port: 9100, payload: 'TkVU' }),
      item({ id: 'usb', connection: 'usb', host: 'USB', payload: 'VVNC' }),
    ]);

    await drainQueue('loc-1');

    // Réclamation de la file, puis un envoi par ticket, chacun avec la bonne liaison.
    expect(apiMock).toHaveBeenCalledWith('GET', '/locations/loc-1/print-queue');
    expect(printRawMock).toHaveBeenCalledTimes(3);
    expect(printRawMock).toHaveBeenCalledWith({ transport: 'bluetooth', data: 'Qk8x', address: 'DC:0D:30:AA:BB:CC' });
    expect(printRawMock).toHaveBeenCalledWith({ transport: 'tcp', data: 'TkVU', host: '10.0.0.9', port: 9100 });
    expect(printRawMock).toHaveBeenCalledWith({ transport: 'usb', data: 'VVNC' });
    // Un accusé « imprimé » par ticket.
    expect(acks()).toEqual([
      ['/print-jobs/bt/ack', { ok: true }],
      ['/print-jobs/net/ack', { ok: true }],
      ['/print-jobs/usb/ack', { ok: true }],
    ]);
  });

  it('en cas d’échec d’impression, accuse la panne (sans bloquer les tickets suivants)', async () => {
    queue([item({ id: 'ko' }), item({ id: 'ok' })]);
    printRawMock.mockRejectedValueOnce(new Error('Imprimante hors tension'));

    await drainQueue('loc-1');

    expect(printRawMock).toHaveBeenCalledTimes(2); // le second ticket est bien tenté malgré l'échec du premier
    expect(acks()).toEqual([
      ['/print-jobs/ko/ack', { ok: false, error: 'Imprimante hors tension' }],
      ['/print-jobs/ok/ack', { ok: true }],
    ]);
  });

  it('file vide : aucun envoi, aucun accusé', async () => {
    queue([]);
    await drainQueue('loc-1');
    expect(printRawMock).not.toHaveBeenCalled();
    expect(acks()).toEqual([]);
  });
});
