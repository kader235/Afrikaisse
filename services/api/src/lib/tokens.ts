import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '@afrikaisse/core';
import type { AppContext } from '../context.ts';

/**
 * Jeton d'accès court (15 min) ne portant que l'utilisateur et la session :
 * rôle, organisation et statuts sont relus en base à chaque requête, pour
 * qu'une désactivation ou une suspension s'applique immédiatement.
 */
export async function signAccessToken(ctx: AppContext, userId: string, sessionId: string) {
  const nowSec = Math.floor(ctx.now() / 1000);
  const expSec = nowSec + ctx.config.accessTokenTtlSec;
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ctx.issuer)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(ctx.jwtKey);
  return { token, expiresAt: expSec * 1000 };
}

export async function verifyAccessToken(ctx: AppContext, token: string) {
  try {
    const { payload } = await jwtVerify(token, ctx.jwtKey, {
      issuer: ctx.issuer,
      algorithms: ['HS256'],
      currentDate: new Date(ctx.now()),
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('claims');
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    throw new AppError('TOKEN_INVALID', 'Session expirée. Reconnectez-vous.');
  }
}

/** Jeton de renouvellement opaque ; seule son empreinte est stockée. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
