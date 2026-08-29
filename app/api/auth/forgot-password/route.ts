import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/auth";
import { mailConfigured, sendPasswordResetEmail } from "@/lib/mailer";
import { recordAuthEvent } from "@/lib/events";
import { checkRateLimit, requestClientKey } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email().max(160) });
const EXPIRES_MINUTES = 30;
const REQUEST_COOLDOWN_MS = 60_000;
const GENERIC_MESSAGE = "Если такой e-mail зарегистрирован, письмо со ссылкой для восстановления будет отправлено.";

function isPrivateOrInternalHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return !host.includes("."); // short internal DNS hostname, e.g. xdesk-server
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some((part) => part < 0 || part > 255)) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function baseUrl(req: NextRequest) {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // Fall through to the request origin for an internal/LAN installation.
    }
    console.warn("[Xdesk] APP_URL is invalid; trying the current internal request origin instead.");
  }

  const current = new URL(req.nextUrl.origin);
  if ((current.protocol === "http:" || current.protocol === "https:") && isPrivateOrInternalHost(current.hostname)) {
    return current.origin;
  }
  throw new Error("APP_URL is required when Xdesk is exposed through a public hostname");
}

export async function POST(req: NextRequest) {
  if (!mailConfigured()) {
    return jsonError("Отправка почты для восстановления пароля пока не настроена администратором", 503);
  }

  const client = requestClientKey(req.headers);
  const globalLimit = checkRateLimit(`forgot:client:${client}`, 500, 15 * 60_000);
  if (!globalLimit.allowed) return NextResponse.json({ error: "Слишком много запросов. Повторите позже" }, { status: 429, headers: { "Retry-After": String(globalLimit.retryAfterSeconds) } });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Введите корректный e-mail");
  const email = parsed.data.email.toLowerCase().trim();
  const emailLimit = checkRateLimit(`forgot:email:${email}`, 5, 15 * 60_000);
  if (!emailLimit.allowed) return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });

  // Always use the same public response for an unknown e-mail: do not expose
  // which addresses exist in the corporate directory.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, isActive: true, isBlocked: true },
  });
  if (!user || !user.isActive || user.isBlocked) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const recent = await prisma.passwordResetToken.findFirst({
    where: {
      userId: user.id,
      usedAt: null,
      createdAt: { gte: new Date(Date.now() - REQUEST_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + EXPIRES_MINUTES * 60_000);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
      },
    });
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
  });

  let resetUrl: string;
  try {
    resetUrl = `${baseUrl(req)}/reset-password?token=${encodeURIComponent(rawToken)}`;
  } catch (error) {
    await prisma.passwordResetToken.deleteMany({ where: { tokenHash } }).catch(() => undefined);
    console.error("Password reset APP_URL configuration error", error);
    return jsonError("Восстановление пароля временно недоступно", 503);
  }
  try {
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl,
      expiresMinutes: EXPIRES_MINUTES,
    });
  } catch (error) {
    await prisma.passwordResetToken.deleteMany({ where: { tokenHash } }).catch(() => undefined);
    console.error("Password reset e-mail failed", error);
    return jsonError("Не удалось отправить письмо. Повторите попытку позже", 503);
  }

  await recordAuthEvent(req, "PASSWORD_RESET_REQUEST", { userId: user.id, email: user.email });
  return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
}
