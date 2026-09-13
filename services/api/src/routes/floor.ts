import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createLocationSchema,
  createTableSchema,
  createZoneSchema,
  diningTableSchema,
  floorSchema,
  layoutSchema,
  locationDetailsSchema,
  updateLocationSchema,
  updateTableSchema,
  updateZoneSchema,
  zoneSchema,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import {
  archiveTable,
  archiveZone,
  createLocation,
  createTable,
  createZone,
  getFloor,
  listLocations,
  saveLayout,
  setLocationStatus,
  updateLocation,
  updateTable,
  updateZone,
} from '../services/floor.ts';

const security = [{ bearer: [] }];
const locationParams = z.object({ locationId: z.uuid() });
const zoneParams = z.object({ zoneId: z.uuid() });
const tableParams = z.object({ tableId: z.uuid() });

export function floorRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));

    // --- Établissements -----------------------------------------------------
    app.get(
      '/locations',
      {
        schema: {
          tags: ['locations'],
          summary: 'Établissements visibles (limités à celui du membre s’il y est rattaché)',
          security,
          querystring: z.object({ includeArchived: z.enum(['true', 'false']).default('false') }),
          response: { 200: z.array(locationDetailsSchema) },
        },
      },
      async (request) => listLocations(ctx, requireTenant(request.auth, 'location.read'), request.query.includeArchived === 'true'),
    );

    app.post(
      '/locations',
      { schema: { tags: ['locations'], summary: 'Créer un établissement', security, body: createLocationSchema, response: { 201: locationDetailsSchema } } },
      async (request, reply) => {
        const location = await createLocation(ctx, requireTenant(request.auth, 'location.manage'), request.body, requestMeta(request));
        reply.code(201);
        return location;
      },
    );

    app.patch(
      '/locations/:locationId',
      { schema: { tags: ['locations'], summary: 'Modifier un établissement (dont son mode d’exploitation)', security, params: locationParams, body: updateLocationSchema, response: { 200: locationDetailsSchema } } },
      async (request) => updateLocation(ctx, requireTenant(request.auth, 'location.manage'), request.params.locationId, request.body, requestMeta(request)),
    );

    for (const [action, status] of [['archive', 'ARCHIVED'], ['restore', 'ACTIVE']] as const) {
      app.post(
        `/locations/:locationId/${action}`,
        { schema: { tags: ['locations'], summary: action === 'archive' ? 'Archiver un établissement' : 'Réactiver un établissement', security, params: locationParams, response: { 200: locationDetailsSchema } } },
        async (request) => setLocationStatus(ctx, requireTenant(request.auth, 'location.manage'), request.params.locationId, status, requestMeta(request)),
      );
    }

    // --- Plan de salle ------------------------------------------------------
    app.get(
      '/locations/:locationId/floor',
      { schema: { tags: ['floor'], summary: 'Plan de salle : zones et tables actives', security, params: locationParams, response: { 200: floorSchema } } },
      async (request) => getFloor(ctx, requireTenant(request.auth, 'tables.read'), request.params.locationId),
    );

    app.post(
      '/locations/:locationId/zones',
      { schema: { tags: ['floor'], summary: 'Créer une zone (salle, terrasse…)', security, params: locationParams, body: createZoneSchema, response: { 201: zoneSchema } } },
      async (request, reply) => {
        const zone = await createZone(ctx, requireTenant(request.auth, 'tables.manage'), request.params.locationId, request.body, requestMeta(request));
        reply.code(201);
        return zone;
      },
    );

    app.patch(
      '/zones/:zoneId',
      { schema: { tags: ['floor'], summary: 'Renommer, réordonner ou redimensionner une zone', security, params: zoneParams, body: updateZoneSchema, response: { 200: zoneSchema } } },
      async (request) => updateZone(ctx, requireTenant(request.auth, 'tables.manage'), request.params.zoneId, request.body, requestMeta(request)),
    );

    app.post(
      '/zones/:zoneId/archive',
      { schema: { tags: ['floor'], summary: 'Archiver une zone vide', security, params: zoneParams, response: { 200: zoneSchema } } },
      async (request) => archiveZone(ctx, requireTenant(request.auth, 'tables.manage'), request.params.zoneId, requestMeta(request)),
    );

    app.put(
      '/zones/:zoneId/layout',
      { schema: { tags: ['floor'], summary: 'Enregistrer la disposition (tout ou rien)', security, params: zoneParams, body: layoutSchema, response: { 200: z.array(diningTableSchema) } } },
      async (request) => saveLayout(ctx, requireTenant(request.auth, 'tables.manage'), request.params.zoneId, request.body, requestMeta(request)),
    );

    app.post(
      '/zones/:zoneId/tables',
      { schema: { tags: ['floor'], summary: 'Ajouter une table (placée automatiquement si aucune position)', security, params: zoneParams, body: createTableSchema, response: { 201: diningTableSchema } } },
      async (request, reply) => {
        const table = await createTable(ctx, requireTenant(request.auth, 'tables.manage'), request.params.zoneId, request.body, requestMeta(request));
        reply.code(201);
        return table;
      },
    );

    app.patch(
      '/tables/:tableId',
      { schema: { tags: ['floor'], summary: 'Modifier une table ou la changer de zone', security, params: tableParams, body: updateTableSchema, response: { 200: diningTableSchema } } },
      async (request) => updateTable(ctx, requireTenant(request.auth, 'tables.manage'), request.params.tableId, request.body, requestMeta(request)),
    );

    app.post(
      '/tables/:tableId/archive',
      { schema: { tags: ['floor'], summary: 'Archiver une table', security, params: tableParams, response: { 200: diningTableSchema } } },
      async (request) => archiveTable(ctx, requireTenant(request.auth, 'tables.manage'), request.params.tableId, requestMeta(request)),
    );
  };
}
