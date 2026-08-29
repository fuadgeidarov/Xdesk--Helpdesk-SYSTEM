import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSessionToken, jsonError, setSessionCookie } from "@/lib/auth";
import { recordAuthEvent } from "@/lib/events";
import { isStore } from "@/lib/stores";
import { checkRateLimit, requestClientKey } from "@/lib/rate-limit";
import { newPasswordSchema } from "@/lib/validation";

const schema = z.object({
  email: z.string().email().max(160),
  password: newPasswordSchema,
  name: z.string().min(2).max(80),
  department: z.string().max(80).optional(),
  phone: z.string().max(40).optional(),
  store: z.string().min(1).refine(isStore, "Выберите магазин"),
});

export async function POST(req: NextRequest) {
  const clientLimit = checkRateLimit(`register:client:${requestClientKey(req.headers)}`, 100, 30 * 60_000);
  if (!clientLimit.allowed) return NextResponse.json({ error: "Слишком много регистраций. Повторите позже" }, { status: 429, headers: { "Retry-After": String(clientLimit.retryAfterSeconds) } });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Проверьте поля формы");

  const email = parsed.data.email.toLowerCase().trim();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return jsonError("Пользователь с таким email уже есть", 409);

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: parsed.data.name.trim(),
        department: parsed.data.department?.trim() || null,
        phone: parsed.data.phone?.trim() || null,
        store: parsed.data.store,
        role: "USER",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("Пользователь с таким email уже есть", 409);
    }
    throw error;
  }

  const token = await createSessionToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    sessionVersion: user.sessionVersion,
  });
  await setSessionCookie(token);
  await recordAuthEvent(req, "REGISTER", { userId: user.id, email: user.email });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}
