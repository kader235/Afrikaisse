import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createMemberSchema, memberSchema, resetPasswordSchema, updateMemberSchema } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth, requireTenant } from '../lib/access.ts';
import { addMember, listMembers, resetMemberPassword, updateMember } from '../services/team.ts';

const params = z.object({ membershipId: z.uuid() });

export function teamRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    app.addHook('preHandler', requireAuth(ctx));
    const security = [{ bearer: [] }];

    app.get(
      '/',
      { schema: { tags: ['team'], summary: "Membres de l'organisation", security, response: { 200: z.array(memberSchema) } } },
      async (request) => listMembers(ctx, requireTenant(request.auth, 'users.read')),
    );

    app.post(
      '/',
      { schema: { tags: ['team'], summary: 'Ajouter un membre', security, body: createMemberSchema, response: { 201: memberSchema } } },
      async (request, reply) => {
        const member = await addMember(ctx, requireTenant(request.auth, 'users.manage'), request.body, requestMeta(request));
        reply.code(201);
        return member;
      },
    );

    app.patch(
      '/:membershipId',
      { schema: { tags: ['team'], summary: 'Modifier rôle, établissement, statut ou nom', security, params, body: updateMemberSchema, response: { 200: memberSchema } } },
      async (request) =>
        updateMember(ctx, requireTenant(request.auth, 'users.manage'), request.params.membershipId, request.body, requestMeta(request)),
    );

    app.post(
      '/:membershipId/password',
      { schema: { tags: ['team'], summary: "Définir un nouveau mot de passe pour un membre", security, params, body: resetPasswordSchema } },
      async (request, reply) => {
        await resetMemberPassword(ctx, requireTenant(request.auth, 'users.manage'), request.params.membershipId, request.body.password, requestMeta(request));
        return reply.code(204).send();
      },
    );
  };
}
