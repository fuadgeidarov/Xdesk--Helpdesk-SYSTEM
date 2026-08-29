import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isStore } from "@/lib/stores";
import { newPasswordSchema } from "@/lib/validation";
import {
  createSessionToken,
  getSessionUser,
  jsonError,
  setSessionCookie,
} from "@/lib/auth";

const schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  department: z.string().max(80).nullable().optional(),
  position: z.string().max(100).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  address: z.string().max(180).nullable().optional(),
  store: z.string().min(1).refine(isStore, "Выберите магазин").nullable().optional(),
  currentPassword: z.string().max(128).optional(),
  password: z.union([z.literal(""), newPasswordSchema]).optional(),
});

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Проверьте данные профиля");

  const data: {
    name?: string;
    email?: string;
    department?: string | null;
    position?: string | null;
    phone?: string | null;
    address?: string | null;
    store?: string | null;
    passwordHash?: string;
    sessionVersion?: { increment: number };
  } = {};

  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, passwordHash: true } });
  if (!current) return jsonError("Пользователь не найден", 404);

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim().toLowerCase();
  const sensitiveChange = email !== current.email || Boolean(parsed.data.password);
  if (sensitiveChange) {
    if (!parsed.data.currentPassword) return jsonError("Для изменения e-mail или пароля укажите текущий пароль", 400);
    const validCurrentPassword = await bcrypt.compare(parsed.data.currentPassword, current.passwordHash);
    if (!validCurrentPassword) return jsonError("Текущий пароль указан неверно", 403);
  }
  data.name = name;
  data.email = email;
  if (parsed.data.department !== undefined) data.department = parsed.data.department?.trim() || null;
  if (parsed.data.position !== undefined) data.position = parsed.data.position?.trim() || null;
  if (parsed.data.phone !== undefined) data.phone = parsed.data.phone?.trim() || null;
  if (parsed.data.address !== undefined) data.address = parsed.data.address?.trim() || null;
  if (parsed.data.store !== undefined) data.store = parsed.data.store || null;
  if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 12);
  if (sensitiveChange) data.sessionVersion = { increment: 1 };

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        department: true,
        position: true,
        phone: true,
        address: true,
        store: true,
        avatarUpdatedAt: true,
        role: true,
        sessionVersion: true,
        createdAt: true,
      },
    });

    const token = await createSessionToken({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      sessionVersion: updated.sessionVersion,
    });
    await setSessionCookie(token);

    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return jsonError("Этот e-mail уже используется другим пользователем", 409);
    }
    throw error;
  }
}
