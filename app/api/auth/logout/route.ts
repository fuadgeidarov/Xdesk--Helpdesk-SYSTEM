import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionUser } from "@/lib/auth";
import { recordAuthEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  // Logout must remain possible even if PostgreSQL is temporarily unavailable.
  // The session cookie is therefore cleared independently from presence/audit writes.
  let user: Awaited<ReturnType<typeof getSessionUser>> = null;
  try {
    user = await getSessionUser();
    if (user && (user.role === "AGENT" || user.role === "ADMIN")) {
      await prisma.user.updateMany({
        where: { id: user.id, isActive: true },
        data: { presenceStatus: "OFFLINE", lastSeenAt: new Date() },
      });
    }
  } catch {
    // Best effort only; cookie clearing below is the security-critical operation.
  }

  await clearSessionCookie();
  if (user) await recordAuthEvent(req, "LOGOUT", { userId: user.id, email: user.email });
  return NextResponse.json({ ok: true });
}
