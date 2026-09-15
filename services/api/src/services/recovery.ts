import { AppError, type RecoveryResetInput, type SetRecoveryInput } from '@afrikaisse/core';
import type { AppContext, RequestMeta } from '../context.ts';
import type { AuthState } from '../lib/access.ts';
import { recordChange, writeAudit } from '../lib/journal.ts';
import { hashPassword, verifyPassword } from '../lib/passwords.ts';
import { assertNotLockedOut, login, type IssuedSession } from './auth.ts';

/**
 * Récupération du compte sans passer par le patron : la personne répond à la question secrète
 * choisie à la création de son compte et choisit un nouveau mot de passe.
 *
 * Casse, accents, espaces et ponctuation ne comptent pas : « N'Djaména » vaut « ndjamena ».
 */
export function normalizeAnswer(answer: string): string {
  return answer
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export async function hashAnswer(answer: string): Promise<string> {
  const normalized = normalizeAnswer(answer);
  if (normalized.length < 2) {
    throw new AppError('VALIDATION', 'Réponse trop courte : écrivez au moins 2 lettres ou chiffres.');
  }
  return hashPassword(normalized);
}

const NO_QUESTION = "Aucune question secrète n'est enregistrée pour cette adresse. Vérifiez l'adresse e-mail.";

export async function recoveryQuestion(ctx: AppContext, email: string): Promise<{ question: string }> {
  const user = await ctx.db
    .selectFrom('users')
    .select(['status', 'recovery_question', 'recovery_answer_hash'])
    .where('email', '=', email)
    .executeTakeFirst();
  if (!user || !user.recovery_question || !user.recovery_answer_hash) throw new AppError('NOT_FOUND', NO_QUESTION);
  if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_DISABLED', 'Ce compte est désactivé.');
  return { question: user.recovery_question };
}

export async function recoverAccount(ctx: AppContext, input: RecoveryResetInput, meta: RequestMeta): Promise<IssuedSession> {
  await assertNotLockedOut(ctx, input.email, 'auth.recovered', 'auth.recovery_failed');

  const user = await ctx.db
    .selectFrom('users')
    .select(['id', 'status', 'recovery_answer_hash'])
    .where('email', '=', input.email)
    .executeTakeFirst();
  if (user && !user.recovery_answer_hash) throw new AppError('NOT_FOUND', NO_QUESTION);
  const valid = await verifyPassword(normalizeAnswer(input.answer), user?.recovery_answer_hash ?? null);
  if (!user || !valid) {
    await writeAudit(ctx.db, ctx, { action: 'auth.recovery_failed', subject: input.email, actorUserId: user?.id ?? null, meta });
    throw new AppError('INVALID_CREDENTIALS', 'Réponse incorrecte.');
  }
  if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_DISABLED', 'Ce compte est désactivé.');

  const hash = await hashPassword(input.newPassword);
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx.updateTable('users').set({ password_hash: hash, updated_at: now, updated_hlc: hlc }).where('id', '=', user.id).execute();
    const row = await trx.selectFrom('users').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow();
    const tenants = await trx.selectFrom('memberships').select('tenant_id').where('user_id', '=', user.id).execute();
    for (const { tenant_id } of tenants) {
      await recordChange(trx, ctx, { tenantId: tenant_id, entityType: 'user', entityId: user.id, operation: 'UPSERT', payload: row, hlc });
    }
    // L'ancien mot de passe a peut-être fuité : tous les appareils sont déconnectés.
    await trx
      .updateTable('auth_sessions')
      .set({ revoked_at: now, revoke_reason: 'password_recovered' })
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .execute();
    await writeAudit(trx, ctx, { tenantId: tenants[0]?.tenant_id ?? null, actorUserId: user.id, action: 'auth.recovered', subject: input.email, meta });
  });

  // La personne est connectée directement avec son nouveau mot de passe.
  return login(ctx, { email: input.email, password: input.newPassword }, meta);
}

export async function setRecovery(ctx: AppContext, auth: AuthState, input: SetRecoveryInput, meta: RequestMeta): Promise<void> {
  const user = await ctx.db.selectFrom('users').select('password_hash').where('id', '=', auth.userId).executeTakeFirstOrThrow();
  if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
    await writeAudit(ctx.db, ctx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'auth.recovery_set_failed', meta });
    throw new AppError('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect.');
  }
  const answerHash = await hashAnswer(input.answer);
  const now = ctx.now();
  await ctx.db.transaction().execute(async (trx) => {
    const hlc = ctx.clock.now();
    await trx
      .updateTable('users')
      .set({ recovery_question: input.question, recovery_answer_hash: answerHash, updated_at: now, updated_hlc: hlc })
      .where('id', '=', auth.userId)
      .execute();
    const row = await trx.selectFrom('users').selectAll().where('id', '=', auth.userId).executeTakeFirstOrThrow();
    const tenants = await trx.selectFrom('memberships').select('tenant_id').where('user_id', '=', auth.userId).execute();
    for (const { tenant_id } of tenants) {
      await recordChange(trx, ctx, { tenantId: tenant_id, entityType: 'user', entityId: auth.userId, operation: 'UPSERT', payload: row, hlc });
    }
    await writeAudit(trx, ctx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'auth.recovery_set', meta });
  });
}
