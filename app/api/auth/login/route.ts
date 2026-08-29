import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSessionToken, jsonError, setSessionCookie } from "@/lib/auth";
import { recordAuthEvent } from "@/lib/events";
import { checkRateLimit, clearRateLimit, requestClientKey } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Введите email и пароль");

  const email = parsed.data.email.toLowerCase().trim();
  const client = requestClientKey(req.headers);
  const emailLimit = checkRateLimit(`login:email:${email}`, 8, 15 * 60_000);
  const clientLimit = checkRateLimit(`login:client:${client}`, 1000, 15 * 60_000);
  if (!emailLimit.allowed || !clientLimit.allowed) {
    const retry = Math.max(emailLimit.retryAfterSeconds, clientLimit.retryAfterSeconds);
    return NextResponse.json({ error: "Слишком много попыток входа. Повторите позже" }, { status: 429, headers: { "Retry-After": String(retry) } });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return jsonError("Неверный email или пароль", 401);

  // Check the password before exposing account state. A random wrong password
  // must not reveal whether an address belongs to a blocked/disabled account.
  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return jsonError("Неверный email или пароль", 401);
  if (!user.isActive) return jsonError("Учётная запись отключена", 403);
  if (user.isBlocked) return jsonError("Учётная запись заблокирована. Обратитесь в IT-поддержку", 403);

  if (user.role === "AGENT" || user.role === "ADMIN") {
    await prisma.user.update({
      where: { id: user.id },
      data: { presenceStatus: "ONLINE", lastSeenAt: new Date() },
    });
  }

  const token = await createSessionToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    sessionVersion: user.sessionVersion,
  });
  clearRateLimit(`login:email:${email}`);
  await setSessionCookie(token);
  await recordAuthEvent(req, "LOGIN", { userId: user.id, email: user.email });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}
