import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isStaff, jsonError } from "@/lib/auth";
import { isStore } from "@/lib/stores";
import { newPasswordSchema } from "@/lib/validation";

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  department: true,
  position: true,
  store: true,
  role: true,
  isBlocked: true,
  lastSeenAt: true,
  presenceStatus: true,
  createdAt: true,
} as const;

export async function GET() {
  const actor = await getSessionUser();
  if (!actor || !isStaff(actor.role)) return jsonError("Доступ запрещен", 403);

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: {
      ...publicUserSelect,
      _count: {
        select: {
          ticketsCreated: true,
          ticketsAssigned: { where: { status: { not: "CLOSED" } } },
          comments: true,
          ratingsGiven: true,
          ratingsReceived: true,
          articles: true,
        },
      },
    },
    orderBy: [{ role: "desc" }, { name: "asc" }],
  });

  const staffIds = users.filter((item) => item.role === "AGENT" || item.role === "ADMIN").map((item) => item.id);
  const ratingGroups = staffIds.length
    ? await prisma.rating.groupBy({
        by: ["agentId"],
        where: { agentId: { in: staffIds } },
        _avg: { score: true },
        _count: { _all: true },
      })
    : [];
  const ratings = new Map(ratingGroups.map((item) => [item.agentId, { average: item._avg.score, count: item._count._all }]));

  return NextResponse.json(
    users.map((item) => ({
      ...item,
      rating: ratings.get(item.id) ?? { average: null, count: 0 },
    })),
  );
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(160),
  password: newPasswordSchema,
  role: z.enum(["USER", "AGENT", "ADMIN"]).default("USER"),
  department: z.string().trim().max(80).optional(),
  position: z.string().trim().max(120).optional(),
  store: z.string().min(1).refine(isStore, "Выберите магазин"),
});

export async function POST(req: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "ADMIN") return jsonError("Только администратор может создавать пользователей", 403);

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Проверьте поля формы");

  const email = parsed.data.email.toLowerCase().trim();
  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
  if (exists) return jsonError("Пользователь с таким e-mail уже существует", 409);

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: parsed.data.name,
        department: parsed.data.department || null,
        position: parsed.data.position || null,
        store: parsed.data.store,
        role: parsed.data.role,
      },
      select: publicUserSelect,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("Пользователь с таким e-mail уже существует", 409);
    }
    throw error;
  }
}

const blockSchema = z.object({
  action: z.literal("block"),
  userId: z.string().min(1),
  blocked: z.boolean(),
});

const updateSchema = z.object({
  action: z.literal("update"),
  userId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(160),
  role: z.enum(["USER", "AGENT", "ADMIN"]),
  department: z.string().trim().max(80).optional(),
  position: z.string().trim().max(120).optional(),
  store: z.string().min(1).refine(isStore, "Выберите магазин"),
  password: z.union([z.literal(""), newPasswordSchema]).optional(),
});

const passwordSchema = z.object({
  action: z.literal("password"),
  userId: z.string().min(1),
  password: newPasswordSchema,
});

const patchSchema = z.discriminatedUnion("action", [blockSchema, updateSchema, passwordSchema]);

export async function PATCH(req: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || !isStaff(actor.role)) return jsonError("Доступ запрещен", 403);

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Неверные данные");

  if (parsed.data.action === "block") {
    const { userId, blocked } = parsed.data;
    if (userId === actor.id) return jsonError("Нельзя заблокировать собственную учётную запись", 400);

    const target = await prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: { id: true, role: true, isBlocked: true, name: true },
    });
    if (!target) return jsonError("Пользователь не найден", 404);
    if (target.role === "ADMIN") return jsonError("Учётную запись администратора блокировать нельзя", 403);
    if (actor.role === "AGENT" && target.role !== "USER") {
      return jsonError("Агент поддержки может блокировать только обычных пользователей", 403);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (blocked && (target.role === "AGENT" || target.role === "ADMIN")) {
        await tx.ticket.updateMany({
          where: { assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED"] } },
          data: { assigneeId: null },
        });
      }
      return tx.user.update({
        where: { id: userId },
        data: { isBlocked: blocked, ...(blocked ? { presenceStatus: "OFFLINE" as const, sessionVersion: { increment: 1 } } : {}) },
        select: { id: true, isBlocked: true, name: true },
      });
    });
    return NextResponse.json(updated);
  }

  if (parsed.data.action === "password") {
    const target = await prisma.user.findFirst({ where: { id: parsed.data.userId, isActive: true }, select: { id: true, role: true } });
    if (!target) return jsonError("Пользователь не найден", 404);
    if (actor.role === "AGENT" && target.role !== "USER") return jsonError("Агент поддержки может менять пароль только обычным пользователям", 403);

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({ where: { userId: target.id, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: target.id }, data: { passwordHash, sessionVersion: { increment: 1 } } }),
    ]);
    return NextResponse.json({ ok: true });
  }

  if (actor.role !== "ADMIN") return jsonError("Редактирование доступно только администратору", 403);

  const data = parsed.data;
  if (data.userId === actor.id && data.role !== "ADMIN") return jsonError("Нельзя снять роль администратора с самого себя", 400);

  const target = await prisma.user.findFirst({ where: { id: data.userId, isActive: true }, select: { id: true, role: true } });
  if (!target) return jsonError("Пользователь не найден", 404);

  if (target.role === "ADMIN" && data.role !== "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN", isActive: true, isBlocked: false } });
    if (adminCount <= 1) return jsonError("Нельзя изменить роль последнего администратора", 409);
  }

  const email = data.email.toLowerCase().trim();
  const emailOwner = await prisma.user.findFirst({ where: { email, id: { not: data.userId } }, select: { id: true } });
  if (emailOwner) return jsonError("Этот e-mail уже используется", 409);

  const updateData: {
    name: string;
    email: string;
    role: "USER" | "AGENT" | "ADMIN";
    department: string | null;
    position: string | null;
    store: string;
    presenceStatus?: "OFFLINE";
    passwordHash?: string;
    sessionVersion?: { increment: number };
  } = {
    name: data.name,
    email,
    role: data.role,
    department: data.department || null,
    position: data.position || null,
    store: data.store,
    ...(data.role === "USER" ? { presenceStatus: "OFFLINE" as const } : {}),
  };
  if (data.password) {
    updateData.passwordHash = await bcrypt.hash(data.password, 12);
    updateData.sessionVersion = { increment: 1 };
  }

  const updated = await prisma.$transaction(async (tx) => {
    if ((target.role === "AGENT" || target.role === "ADMIN") && data.role === "USER") {
      await tx.ticket.updateMany({
        where: { assigneeId: data.userId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED"] } },
        data: { assigneeId: null },
      });
    }
    return tx.user.update({ where: { id: data.userId }, data: updateData, select: publicUserSelect });
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "ADMIN") return jsonError("Только администратор может удалять пользователей", 403);

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return jsonError("Не указан пользователь");
  if (userId === actor.id) return jsonError("Нельзя удалить свою учётную запись", 400);

  const target = await prisma.user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true, role: true },
  });
  if (!target) return jsonError("Пользователь не найден", 404);

  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN", isActive: true, isBlocked: false } });
    if (adminCount <= 1) return jsonError("Нельзя удалить последнего администратора", 409);
  }

  await prisma.$transaction([
    prisma.ticket.updateMany({
      where: { assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED"] } },
      data: { assigneeId: null },
    }),
    prisma.user.update({ where: { id: userId }, data: { isActive: false, isBlocked: true, presenceStatus: "OFFLINE", sessionVersion: { increment: 1 } } }),
  ]);

  return NextResponse.json({ ok: true, archived: true });
}
