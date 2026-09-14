import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '@afrikaisse/core';
import type { AppDatabase } from '@afrikaisse/database';
import type { AppContext } from '../context.ts';
import { requireAuth, requireTenant } from '../lib/access.ts';
import { writeAudit } from '../lib/journal.ts';
import { backupNow, listBackups } from '../lib/backup.ts';

const backupFileSchema = z.object({ name: z.string(), size: z.number(), createdAt: z.number() });

/** Système du serveur local : sauvegardes de la base (§69). */
export function systemRoutes(ctx: AppContext, database: AppDatabase): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const dir = ctx.config.backupDir && database.kind === 'sqlite' ? ctx.config.backupDir : null;
    const security = [{ bearer: [] }];

    app.get(
      '/system/backups',
      {
        schema: {
          tags: ['system'],
          summary: 'Sauvegardes de la base du serveur local',
          security,
          response: { 200: z.object({ enabled: z.boolean(), dir: z.string().nullable(), files: z.array(backupFileSchema) }) },
        },
      },
      async (request) => {
        requireTenant(request.auth, 'settings.manage');
        return { enabled: dir !== null, dir, files: dir ? listBackups(dir).slice(0, 60) : [] };
      },
    );

    app.post(
      '/system/backups',
      { schema: { tags: ['system'], summary: 'Sauvegarder maintenant (copie vérifiée)', security, response: { 201: backupFileSchema } } },
      async (request, reply) => {
        const scope = requireTenant(request.auth, 'settings.manage');
        if (!dir) throw new AppError('CONFLICT', 'Les sauvegardes intégrées concernent le serveur local du restaurant. Dans le Cloud, elles sont assurées par l’hébergeur.');
        const file = await backupNow(database, dir, 'manuelle');
        await writeAudit(ctx.db, ctx, { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'system.backup', data: { name: file.name, size: file.size } });
        reply.code(201);
        return file;
      },
    );
  };
}
