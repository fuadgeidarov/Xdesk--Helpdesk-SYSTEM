import { AuthEventType } from "@prisma/client";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";

function clientIp(req: NextRequest) {
  // Forwarded IP headers are attacker-controlled unless a trusted reverse proxy
  // overwrites them. Keep them disabled for direct Docker/LAN deployments.
  if (process.env.TRUST_PROXY !== "true") return null;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd.slice(0, 80);
  return req.headers.get("x-real-ip")?.trim().slice(0, 80) || null;
}

/**
 * Пишет событие входа/регистрации/выхода/посещения в журнал.
 * Никогда не роняет основной запрос — журнал вторичен.
 */
export async function recordAuthEvent(
  req: NextRequest,
  type: AuthEventType,
  opts: { userId?: string | null; email?: string | null } = {},
) {
  try {
    await prisma.authEvent.create({
      data: {
        type,
        userId: opts.userId ?? null,
        email: opts.email ?? null,
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
    });
    if (opts.userId) {
      await prisma.user.update({
        where: { id: opts.userId },
        data: { lastSeenAt: new Date() },
      });
    }
  } catch (e) {
    console.error("authEvent failed", e);
  }
}
