import { PrismaClient, PresenceStatus, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const accounts = [
  {
    email: process.env.SEED_USER_EMAIL || "user@xdesk.local",
    env: "SEED_USER_PASSWORD",
    name: "Тестовый пользователь",
    department: "Сотрудники",
    position: "Сотрудник",
    role: Role.USER,
  },
  {
    email: process.env.SEED_AGENT_EMAIL || "agent@xdesk.local",
    env: "SEED_AGENT_PASSWORD",
    name: "Тестовый агент",
    department: "IT",
    position: "Специалист поддержки",
    role: Role.AGENT,
  },
  {
    email: process.env.SEED_ADMIN_EMAIL || "admin@xdesk.local",
    env: "SEED_ADMIN_PASSWORD",
    name: "Тестовый администратор",
    department: "IT",
    position: "Администратор",
    role: Role.ADMIN,
  },
] as const;

function passwordFromEnv(name: string) {
  const value = process.env[name];
  if (!value || value.length < 12) {
    throw new Error(`${name} must be set and contain at least 12 characters.`);
  }
  return value;
}

async function main() {
  // Non-destructive seed: creates/repairs only the three standard accounts.
  // Password rotation invalidates already-issued sessions via sessionVersion.
  // It deliberately does NOT delete later users. Use `npm run db:reset-test`
  // once when a completely clean test database is required.
  for (const account of accounts) {
    const password = passwordFromEnv(account.env);
    const existing = await prisma.user.findUnique({
      where: { email: account.email },
      select: { id: true, passwordHash: true },
    });

    if (!existing) {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: {
          email: account.email,
          passwordHash,
          name: account.name,
          department: account.department,
          position: account.position,
          store: "Офис",
          role: account.role,
          isActive: true,
          isBlocked: false,
          presenceStatus: PresenceStatus.OFFLINE,
        },
      });
      continue;
    }

    const passwordMatches = await bcrypt.compare(password, existing.passwordHash);
    const passwordHash = passwordMatches ? undefined : await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(passwordHash
          ? { passwordHash, sessionVersion: { increment: 1 } }
          : {}),
        name: account.name,
        department: account.department,
        position: account.position,
        store: "Офис",
        role: account.role,
        isActive: true,
        isBlocked: false,
        presenceStatus: PresenceStatus.OFFLINE,
      },
    });
  }

  console.log("[Xdesk] Standard USER / AGENT / ADMIN accounts are ready.");
  console.log("[Xdesk] Seed is non-destructive; later-created users are preserved.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
