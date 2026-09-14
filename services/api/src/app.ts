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
import { authRoutes } from './routes/auth.ts';
import { floorRoutes } from './routes/floor.ts';
import { menuRoutes, publicRoutes } from './routes/menu.ts';
import { orderRoutes, publicOrderRoutes } from './routes/orders.ts';
import { posRoutes } from './routes/pos.ts';
import { teamRoutes } from './routes/team.ts';
import { platformRoutes, tenantRoutes } from './routes/tenant.ts';

export const API_VERSION = '0.1.0';

export interface BuildOptions {
  database: AppDatabase;
  config: AppConfig;
  logger?: FastifyServerOptions['logger'];
  now?: () => number;
}

/**
 * Une seule application pour les deux profils : le Cloud et le serveur local
 * exécutent exactement les mêmes règles métier, seul le moteur SQL change.
 */
export async function buildApp(opts: BuildOptions) {
  const { database, config } = opts;
  const now = opts.now ?? Date.now;
  const node = await initNode(database.db, config.profile, now());
  const ctx: AppContext = {
    db: database.db,
    dbKind: database.kind,
    config,
    nodeId: node.nodeId,
    issuer: `afrikaisse:${node.nodeId}`,
    jwtKey: new TextEncoder().encode(config.jwtSecret ?? node.jwtSecret),
    clock: new HybridClock(node.nodeId, now),
    now,
  };

  const app = Fastify({ logger: opts.logger ?? false, trustProxy: config.trustProxy, bodyLimit: 1024 * 1024 }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('auth', null);

  await app.register(helmet, { contentSecurityPolicy: false });
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

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
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
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Erreur interne. Réessayez.' } });
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
            time: z.number(),
          }),
        },
      },
    },
    async () => {
      await sql`select 1`.execute(ctx.db);
      return { status: 'ok' as const, profile: config.profile, nodeId: ctx.nodeId, database: ctx.dbKind, version: API_VERSION, time: ctx.now() };
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
  if (config.profile === 'cloud') {
    await app.register(platformRoutes(ctx), { prefix: '/api/platform' });
  }

  return { app, ctx };
}
