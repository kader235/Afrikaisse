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

const host = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9.-]+$/, 'Adresse IP ou nom de l’imprimante, sans http:// ni port (ex. 192.168.1.50).');

export const createPrinterSchema = z.object({
  name: z.string().trim().min(1).max(40),
  host,
  port: z.number().int().min(1).max(65535).default(9100),
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
  width: z.number(),
  stationId: z.string().nullable(),
  stationName: z.string().nullable(),
  printsKitchen: z.boolean(),
  printsReceipts: z.boolean(),
  lastOkAt: z.number().nullable(),
  lastError: z.string().nullable(),
});
export type Printer = z.infer<typeof printerSchema>;

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
