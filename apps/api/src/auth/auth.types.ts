import type { UserRole } from '../generated/prisma/client.js';

/** The authenticated caller, attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  businessId: string;
  email: string;
  name: string;
  role: UserRole;
}

/**
 * Only the user id goes in the token. Role and business are re-read from the
 * database on every request, so role changes and removed users take effect
 * immediately instead of when the token expires.
 */
export interface JwtPayload {
  sub: string;
}

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24; // 1 day
