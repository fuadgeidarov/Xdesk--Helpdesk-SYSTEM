import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/auth";
import { recordAuthEvent } from "@/lib/events";
import { checkRateLimit, requestClientKey } from "@/lib/rate-limit";
import { newPasswordSchema } from "@/lib/validation";

const schema = z.object({
  token: z.string().min(20).max(300),
  password: newPasswordSchema,
});

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(`reset:client:${requestClientKey(req.headers)}`, 300, 15 * 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Слишком много попыток. Повторите позже" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Проверьте ссылку и новый пароль (минимум 8 символов)");

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, isActive: true, isBlocked: true } } },
  });

  if (!token || token.usedAt || token.expiresAt <= new Date() || !token.user.isActive || token.user.isBlocked) {
    return jsonError("Ссылка недействительна или срок её действия истёк", 400);
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;

    await tx.user.update({ where: { id: token.user.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await tx.passwordResetToken.updateMany({
      where: { userId: token.user.id, id: { not: token.id }, usedAt: null },
      data: { usedAt: now },
    });
    return true;
  });

  if (!result) return jsonError("Ссылка уже была использована", 400);
  await recordAuthEvent(req, "PASSWORD_RESET", { userId: token.user.id, email: token.user.email });
  return NextResponse.json({ ok: true });
}
