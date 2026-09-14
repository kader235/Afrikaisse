import { z } from 'zod';

/** Avancement de la mise en route d'un établissement (écran « Bien démarrer », §70). */
export const setupStatusSchema = z.object({
  locationId: z.string(),
  zones: z.number(),
  tables: z.number(),
  categories: z.number(),
  products: z.number(),
  stations: z.number(),
  members: z.number(),
  cashSessions: z.number(),
  orders: z.number(),
  /** Assez pour servir : au moins une table et un produit. */
  complete: z.boolean(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;
