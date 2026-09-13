import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  changePasswordSchema,
  loginSchema,
  meSchema,
  refreshSchema,
  registerSchema,
  sessionResponseSchema,
  switchTenantSchema,
} from '@afrikaisse/core';
import type { AppContext } from '../context.ts';
import { requestMeta, requireAuth } from '../lib/access.ts';
import {
  changeOwnPassword,
  loadMe,
  login,
  refresh,
  register,
  revokeSession,
  sessionPayload,
  switchTenant,
  type IssuedSession,
} from '../services/auth.ts';

export const REFRESH_COOKIE = 'afk_refresh';

/**
 * Deux modes de transport du jeton de renouvellement :
 * - navigateur (en-tête `x-afk-client: web`) : cookie httpOnly SameSite=Strict,
 *   jamais lisible par JavaScript ;
 * - applications natives (mobile, desktop) : dans le corps, rangé ensuite dans
 *   le stockage sécurisé de l'appareil.
 */
export function authRoutes(ctx: AppContext): FastifyPluginAsyncZod {
  return async (app) => {
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: ctx.config.cookieSecure,
      path: '/api/auth',
      maxAge: ctx.config.sessionTtlSec,
    };

    async function respond(request: FastifyRequest, reply: FastifyReply, issued: IssuedSession) {
      const web = request.headers['x-afk-client'] === 'web';
      if (web && issued.refreshToken) reply.setCookie(REFRESH_COOKIE, issued.refreshToken, cookieOptions);
      const payload = await sessionPayload(ctx, issued);
      return web || !issued.refreshToken ? payload : { ...payload, refreshToken: issued.refreshToken };
    }

    app.post(
      '/register',
      { schema: { tags: ['auth'], summary: 'Créer une organisation, son premier établissement et son propriétaire', body: registerSchema, response: { 201: sessionResponseSchema } } },
      async (request, reply) => {
        const issued = await register(ctx, request.body, requestMeta(request));
        reply.code(201);
        return respond(request, reply, issued);
      },
    );

    app.post(
      '/login',
      { schema: { tags: ['auth'], summary: 'Connexion par e-mail et mot de passe', body: loginSchema, response: { 200: sessionResponseSchema } } },
      async (request, reply) => respond(request, reply, await login(ctx, request.body, requestMeta(request))),
    );

    app.post(
      '/refresh',
      { schema: { tags: ['auth'], summary: 'Renouveler le jeton d’accès (rotation du jeton de renouvellement)', body: refreshSchema.optional(), response: { 200: sessionResponseSchema } } },
      async (request, reply) => {
        const token = request.body?.refreshToken ?? request.cookies[REFRESH_COOKIE];
        return respond(request, reply, await refresh(ctx, token, requestMeta(request)));
      },
    );

    app.post(
      '/logout',
      { preHandler: requireAuth(ctx), schema: { tags: ['auth'], summary: 'Révoquer la session courante', security: [{ bearer: [] }] } },
      async (request, reply) => {
        await revokeSession(ctx.db, ctx, request.auth!.sessionId, 'logout');
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
        return reply.code(204).send();
      },
    );

    app.get(
      '/me',
      { preHandler: requireAuth(ctx), schema: { tags: ['auth'], summary: 'Identité, organisation courante, rôle et permissions', security: [{ bearer: [] }], response: { 200: meSchema } } },
      async (request) => loadMe(ctx, request.auth!),
    );

    app.post(
      '/switch-tenant',
      { preHandler: requireAuth(ctx), schema: { tags: ['auth'], summary: 'Changer d’organisation courante', security: [{ bearer: [] }], body: switchTenantSchema, response: { 200: sessionResponseSchema } } },
      async (request, reply) => respond(request, reply, await switchTenant(ctx, request.auth!, request.body.tenantId, requestMeta(request))),
    );

    app.post(
      '/password',
      { preHandler: requireAuth(ctx), schema: { tags: ['auth'], summary: 'Changer son propre mot de passe', security: [{ bearer: [] }], body: changePasswordSchema } },
      async (request, reply) => {
        await changeOwnPassword(ctx, request.auth!, request.body.currentPassword, request.body.newPassword, requestMeta(request));
        return reply.code(204).send();
      },
    );
  };
}
