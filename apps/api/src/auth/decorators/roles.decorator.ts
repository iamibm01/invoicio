import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles. Routes without it allow any signed-in user. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
