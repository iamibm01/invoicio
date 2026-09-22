import type { Prisma } from '../generated/prisma/client.js';

/** The user columns safe to expose — never includes passwordHash. */
export const authUserSelect = {
  id: true,
  businessId: true,
  email: true,
  name: true,
  role: true,
} satisfies Prisma.UserSelect;
