import { PrismaClient, PresenceStatus, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readdir, rm } from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

type TestAccount = {
  email: string;
  passwordEnv: string;
  name: string;
  department: string;
  position: string;
  store: string;
  role: Role;
};

const TEST_ACCOUNTS: readonly TestAccount[] = [
  {
    email: process.env.SEED_USER_EMAIL || "user@xdesk.local",
    passwordEnv: "SEED_USER_PASSWORD",
    name: "Тестовый пользователь",
    department: "Сотрудники",
    position: "Сотрудник",
    store: "Офис",
    role: Role.USER,
  },
  {
    email: process.env.SEED_AGENT_EMAIL || "agent@xdesk.local",
    passwordEnv: "SEED_AGENT_PASSWORD",
    name: "Тестовый агент",
    department: "IT",
    position: "Специалист поддержки",
    store: "Офис",
    role: Role.AGENT,
  },
  {
    email: process.env.SEED_ADMIN_EMAIL || "admin@xdesk.local",
    passwordEnv: "SEED_ADMIN_PASSWORD",
    name: "Тестовый администратор",
    department: "IT",
    position: "Администратор",
    store: "Офис",
    role: Role.ADMIN,
  },
];

function passwordFromEnv(name: string) {
  const value = process.env[name];
  if (!value || value.length < 12) {
    throw new Error(`${name} must be set and contain at least 12 characters.`);
  }
  return value;
}

async function clearUploadDirectory() {
  const root = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    await Promise.all(
      entries.map((entry) => rm(path.join(root, entry.name), { recursive: true, force: true }))
    );
    console.log(`[Xdesk] Cleared upload storage: ${root}`);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function main() {
  if (process.env.XDESK_ALLOW_TEST_RESET !== "true") {
    throw new Error(
      "Refusing destructive reset. Run with XDESK_ALLOW_TEST_RESET=true only for the test database."
    );
  }

  console.log("[Xdesk] WARNING: destructive TEST database reset started.");

  // Remove dependent application data first so no old account remains referenced.
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeAttachment.deleteMany();
    await tx.knowledgeArticle.deleteMany();
    await tx.attachment.deleteMany();
    await tx.rating.deleteMany();
    await tx.comment.deleteMany();
    await tx.ticket.deleteMany();
    await tx.authEvent.deleteMany();
    await tx.user.deleteMany();
  }, { maxWait: 10_000, timeout: 30_000 });

  await clearUploadDirectory();

  for (const account of TEST_ACCOUNTS) {
    const passwordHash = await bcrypt.hash(passwordFromEnv(account.passwordEnv), 12);
    await prisma.user.create({
      data: {
        email: account.email,
        passwordHash,
        name: account.name,
        department: account.department,
        position: account.position,
        store: account.store,
        role: account.role,
        isActive: true,
        isBlocked: false,
        presenceStatus: PresenceStatus.OFFLINE,
      },
    });
  }

  const users = await prisma.user.findMany({
    orderBy: { role: "asc" },
    select: { email: true, role: true, isActive: true, isBlocked: true },
  });

  if (users.length !== 3) {
    throw new Error(`Reset validation failed: expected 3 users, got ${users.length}.`);
  }

  const expected = new Map<string, Role>(TEST_ACCOUNTS.map((item) => [item.email, item.role]));
  for (const user of users) {
    if (expected.get(user.email) !== user.role || !user.isActive || user.isBlocked) {
      throw new Error(`Reset validation failed for ${user.email}.`);
    }
  }

  console.log("[Xdesk] Test database reset complete. Exactly 3 accounts exist:");
  for (const account of TEST_ACCOUNTS) {
    console.log(`  ${account.role}: ${account.email}`);
  }
  console.log("[Xdesk] New accounts created later through the UI/API will persist normally.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
