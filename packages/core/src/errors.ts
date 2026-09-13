export const ERROR_CODES = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  TENANT_SUSPENDED: 403,
  ACCOUNT_DISABLED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_ATTEMPTS: 429,
  INTERNAL: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

/** Erreur métier : le message est destiné à l'utilisateur, le code au programme. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}
