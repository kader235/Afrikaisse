import { registerRateLimits } from './lib/rateLimit.ts';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { AppError, HybridClock } from '@afrikaisse/core';
import type { AppDatabase } from '@afrikaisse/database';
import type { AppConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { initNode } from './lib/node.ts';
import { lanUrls, registerWebApp } from './lib/web.ts';
import { setSyncTransport, type SyncTransport } from './services/sync/client.ts';
import { syncRoutes } from './routes/sync.ts';
import { authRoutes } from './routes/auth.ts';
import { floorRoutes } from './routes/floor.ts';
import { menuRoutes, publicRoutes } from './routes/menu.ts';
import { orderRoutes, publicOrderRoutes } from './routes/orders.ts';
import { posRoutes } from './routes/pos.ts';
import { pricingRoutes, publicPricingRoutes } from './routes/pricing.ts';
import { kitchenRoutes } from './routes/kitchen.ts';
import { reportRoutes } from './routes/reports.ts';
import { analyticsRoutes } from './routes/analytics.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { setupRoutes } from './routes/setup.ts';
import { stockRoutes } from './routes/stock.ts';
import { systemRoutes } from './routes/system.ts';
import { printerRoutes } from './routes/printers.ts';
import { teamRoutes } from './routes/team.ts';
import { platformRoutes, tenantRoutes } from './routes/tenant.ts';
import { randomUUID } from 'node:crypto';
import { captureError } from './lib/errorLog.ts';
import { categoryLoggers } from './lib/logger.ts';
import { monitoringRoutes, releaseRoutes } from './routes/monitoring.ts';
import { platformBackOfficeRoutes } from './routes/platform.ts';

/** Refus à tracer dans le journal « security » (§74). */
const SECURITY_CODES = new Set(['TOO_MANY_ATTEMPTS', 'INVALID_CREDENTIALS', 'TOKEN_INVALID']);

export const API_VERSION = '0.1.0';
declare const __AFK_BUILD__: string | undefined;
/** Numéro écrit par la construction du paquet : le script de dépôt vérifie qu'il parle à la nouvelle version. */
export const API_BUILD = typeof __AFK_BUILD__ === 'string' ? __AFK_BUILD__ : 'dev';

export interface BuildOptions {
  database: AppDatabase;
  config: AppConfig;
  logger?: FastifyServerOptions['logger'];
  now?: () => number;
  /** Tests : appels vers le Cloud sans réseau. */
  syncTransport?: SyncTransport;
}

/**
 * Une seule application pour les deux profils : le Cloud et le serveur local
 * exécutent exactement les mêmes règles métier, seul le moteur SQL change.
 */
export async function buildApp(opts: BuildOptions) {
  const { database, config } = opts;
  const now = opts.now ?? Date.now;
  const node = await initNode(database.db, config.profile, now());
  // Identifiant de requête unique (UUID) : il relie la réponse 500, le journal et la ligne du back-office.
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: config.trustProxy, bodyLimit: 1024 * 1024, genReqId: () => randomUUID() }).withTypeProvider<ZodTypeProvider>();
  const ctx: AppContext = {
    db: database.db,
    dbKind: database.kind,
    config,
    nodeId: node.nodeId,
    issuer: `afrikaisse:${node.nodeId}`,
    jwtKey: new TextEncoder().encode(config.jwtSecret ?? node.jwtSecret),
    clock: new HybridClock(node.nodeId, now),
    now,
    log: categoryLoggers(app.log),
    version: API_VERSION,
    build: API_BUILD,
    startedAt: now(),
  };
  if (opts.syncTransport) setSyncTransport(ctx, opts.syncTransport);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('auth', null);

  await app.register(helmet, { contentSecurityPolicy: false });
  registerRateLimits(app, ctx);
  await app.register(cors, { origin: config.corsOrigins.length > 0 ? config.corsOrigins : false, credentials: true });
  await app.register(cookie);
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'AfriKaisse API',
        version: API_VERSION,
        description: 'API commune au Cloud AfriKaisse et au serveur local du restaurant.',
      },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof AppError) {
      if (SECURITY_CODES.has(error.code)) ctx.log.security.warn({ code: error.code, method: request.method, route: request.routeOptions.url ?? null, ip: request.ip }, error.message);
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: 'Données invalides.',
          details: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    const status = isResponseSerializationError(error) ? 500 : (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: (error as Error).message } });
    }
    request.log.error({ category: 'application', err: error }, 'Erreur interne');
    // Journal d'erreurs du back-office (§67) : sans corps ni en-têtes ; son échec ne masque pas la réponse.
    await captureError(ctx, {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? null,
      status: 500,
      code: isResponseSerializationError(error) ? 'SERIALIZATION' : 'INTERNAL',
      message: `${(error as Error).name ?? 'Error'}: ${(error as Error).message ?? ''}`,
      tenantId: request.auth?.tenantId ?? null,
    }).catch((err) => ctx.log.database.error({ err }, "Journal d'erreurs indisponible"));
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Erreur interne. Réessayez.', details: { requestId: request.id } } });
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route introuvable.' } }));

  app.get(
    '/api/health',
    {
      schema: {
        tags: ['system'],
        summary: 'État du nœud et de sa base',
        response: {
          200: z.object({
            status: z.literal('ok'),
            profile: z.enum(['cloud', 'local']),
            nodeId: z.string(),
            database: z.enum(['postgres', 'sqlite']),
            version: z.string(),
            build: z.string(),
            time: z.number(),
            /** Serveur local : adresses à saisir sur les tablettes et téléphones du restaurant. */
            lanUrls: z.array(z.string()).optional(),
            /** Serveur local : false tant qu'aucun restaurant n'est créé ni relié au Cloud. */
            configured: z.boolean().optional(),
          }),
        },
      },
    },
    async () => {
      await sql`select 1`.execute(ctx.db);
      const base = { status: 'ok' as const, profile: config.profile, nodeId: ctx.nodeId, database: ctx.dbKind, version: API_VERSION, build: API_BUILD, time: ctx.now() };
      if (config.profile !== 'local') return base;
      const address = app.server.address();
      const tenant = await ctx.db.selectFrom('tenants').select('id').limit(1).executeTakeFirst();
      return { ...base, lanUrls: lanUrls(address && typeof address === 'object' ? address.port : config.port), configured: !!tenant };
    },
  );

  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(authRoutes(ctx), { prefix: '/api/auth' });
  await app.register(teamRoutes(ctx), { prefix: '/api/team' });
  await app.register(tenantRoutes(ctx), { prefix: '/api' });
  await app.register(floorRoutes(ctx), { prefix: '/api' });
  await app.register(menuRoutes(ctx), { prefix: '/api' });
  await app.register(publicRoutes(ctx), { prefix: '/api' });
  await app.register(orderRoutes(ctx), { prefix: '/api' });
  await app.register(publicOrderRoutes(ctx), { prefix: '/api' });
  await app.register(posRoutes(ctx), { prefix: '/api' });
  await app.register(pricingRoutes(ctx), { prefix: '/api' });
  await app.register(publicPricingRoutes(ctx), { prefix: '/api' });
  await app.register(kitchenRoutes(ctx), { prefix: '/api' });
  await app.register(reportRoutes(ctx), { prefix: '/api' });
  await app.register(analyticsRoutes(ctx), { prefix: '/api' });
  await app.register(notificationRoutes(ctx), { prefix: '/api' });
  await app.register(setupRoutes(ctx), { prefix: '/api' });
  await app.register(stockRoutes(ctx), { prefix: '/api' });
  await app.register(systemRoutes(ctx, database), { prefix: '/api' });
  await app.register(printerRoutes(ctx), { prefix: '/api' });
  await app.register(syncRoutes(ctx), { prefix: '/api' });
  await app.register(monitoringRoutes(ctx), { prefix: '/api' });
  await app.register(releaseRoutes(ctx), { prefix: '/api' });
  if (config.profile === 'cloud') {
    await app.register(platformRoutes(ctx), { prefix: '/api/platform' });
    await app.register(platformBackOfficeRoutes(ctx), { prefix: '/api/platform' });
  }
  if (config.webDir) registerWebApp(app, config.webDir);

  return { app, ctx };
}
