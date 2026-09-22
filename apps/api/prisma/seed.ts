// Local development seed: one business with a user per role.
// Idempotent — safe to re-run. Password for every seeded user: "password123".
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEMO_BUSINESS_NAME = 'Demo Co';

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  const business =
    (await prisma.business.findFirst({ where: { name: DEMO_BUSINESS_NAME } })) ??
    (await prisma.business.create({
      data: { name: DEMO_BUSINESS_NAME, defaultCurrency: 'AED' },
    }));

  const users = [
    { email: 'admin@demo.test', name: 'Demo Admin', role: UserRole.ADMIN },
    { email: 'approver@demo.test', name: 'Demo Approver', role: UserRole.APPROVER },
    { email: 'submitter@demo.test', name: 'Demo Submitter', role: UserRole.SUBMITTER },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, passwordHash, businessId: business.id },
    });
  }

  console.log(`Seeded business "${business.name}" with ${users.length} users`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
