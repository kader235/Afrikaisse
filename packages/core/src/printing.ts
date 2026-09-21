import { z } from 'zod';

/**
 * Imprimantes thermiques réseau (ESC/POS, port 9100) : tickets cuisine par poste et reçus.
 * L'envoi part du serveur local du restaurant, le seul à voir les imprimantes du réseau.
 */

export const PRINT_JOB_KINDS = ['KITCHEN', 'RECEIPT', 'TEST'] as const;
export type PrintJobKind = (typeof PRINT_JOB_KINDS)[number];

export const PRINT_JOB_KIND_LABELS: Record<PrintJobKind, string> = { KITCHEN: 'Ticket cuisine', RECEIPT: 'Reçu', TEST: 'Test' };

export const PRINT_JOB_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/**
 * `network` : adresse IP ou nom réseau (ex. 192.168.1.50). `bluetooth` : adresse de l'imprimante
 * appairée, souvent une adresse MAC à deux-points (ex. DC:0D:30:AA:BB:CC), d'où les `:` autorisés.
 */
const host = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9.:_-]+$/, 'Adresse de l’imprimante, sans http:// ni port (ex. 192.168.1.50 ou DC:0D:30:AA:BB:CC).');

/** `network` : ESC/POS en TCP 9100. `bluetooth` : envoi Bluetooth depuis l'appareil. */
export const PRINTER_CONNECTIONS = ['network', 'bluetooth'] as const;
export type PrinterConnection = (typeof PRINTER_CONNECTIONS)[number];

/** `server` : le serveur local vide la file. `device` : une tablette imprime elle-même (restaurant sans PC). */
export const PRINTER_DRIVERS = ['server', 'device'] as const;
export type PrinterDriver = (typeof PRINTER_DRIVERS)[number];

export const createPrinterSchema = z.object({
  name: z.string().trim().min(1).max(40),
  host,
  port: z.number().int().min(1).max(65535).default(9100),
  connection: z.enum(PRINTER_CONNECTIONS).default('network'),
  driver: z.enum(PRINTER_DRIVERS).default('server'),
  /** 48 caractères : papier 80 mm ; 32 : papier 58 mm. */
  width: z.union([z.literal(48), z.literal(32)]).default(48),
  /** Poste dont elle imprime les tickets ; null : tous les postes. */
  stationId: z.uuid().nullable().default(null),
  printsKitchen: z.boolean().default(true),
  printsReceipts: z.boolean().default(false),
});
export type CreatePrinterInput = z.infer<typeof createPrinterSchema>;

export const updatePrinterSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    host,
    port: z.number().int().min(1).max(65535),
    connection: z.enum(PRINTER_CONNECTIONS),
    driver: z.enum(PRINTER_DRIVERS),
    width: z.union([z.literal(48), z.literal(32)]),
    stationId: z.uuid().nullable(),
    printsKitchen: z.boolean(),
    printsReceipts: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucune modification demandée' });
export type UpdatePrinterInput = z.infer<typeof updatePrinterSchema>;

export const printerSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  connection: z.enum(PRINTER_CONNECTIONS),
  driver: z.enum(PRINTER_DRIVERS),
  width: z.number(),
  stationId: z.string().nullable(),
  stationName: z.string().nullable(),
  printsKitchen: z.boolean(),
  printsReceipts: z.boolean(),
  lastOkAt: z.number().nullable(),
  lastError: z.string().nullable(),
});
export type Printer = z.infer<typeof printerSchema>;

/**
 * Un ticket à imprimer, tel que la tablette le récupère : les octets ESC/POS déjà fabriqués (base64)
 * et de quoi joindre l'imprimante (connexion, adresse). La tablette envoie, puis accuse réception (`ack`).
 */
export const printQueueItemSchema = z.object({
  id: z.string(),
  printerId: z.string(),
  printerName: z.string(),
  connection: z.enum(PRINTER_CONNECTIONS),
  host: z.string(),
  port: z.number(),
  width: z.number(),
  kind: z.enum(PRINT_JOB_KINDS),
  /** Octets ESC/POS en base64, prêts à envoyer tels quels à l'imprimante. */
  payload: z.string(),
});
export type PrintQueueItem = z.infer<typeof printQueueItemSchema>;

/** Résultat d'impression renvoyé par la tablette : réussi, ou en échec avec le message de l'appareil. */
export const printAckSchema = z.object({
  ok: z.boolean(),
  error: z.string().trim().max(300).nullable().default(null),
});
export type PrintAckInput = z.infer<typeof printAckSchema>;

export const printJobSchema = z.object({
  id: z.string(),
  printerId: z.string(),
  printerName: z.string(),
  kind: z.enum(PRINT_JOB_KINDS),
  status: z.enum(PRINT_JOB_STATUSES),
  attempts: z.number(),
  lastError: z.string().nullable(),
  orderNumber: z.number().nullable(),
  createdAt: z.number(),
  sentAt: z.number().nullable(),
});
export type PrintJob = z.infer<typeof printJobSchema>;
