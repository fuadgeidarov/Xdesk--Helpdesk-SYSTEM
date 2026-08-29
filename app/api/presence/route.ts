import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, jsonError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canSetPresence } from "@/lib/access";

const schema = z.object({ status: z.enum(["ONLINE", "AWAY", "OFFLINE"]) });

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  if (!canSetPresence(user.role)) return jsonError("Статус доступен только IT-поддержке", 403);
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { presenceStatus: true } });
  return NextResponse.json({ status: row?.presenceStatus ?? "OFFLINE" });
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  if (!canSetPresence(user.role)) return jsonError("Статус доступен только IT-поддержке", 403);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Некорректный статус");
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { presenceStatus: parsed.data.status, lastSeenAt: new Date() },
    select: { presenceStatus: true },
  });
  return NextResponse.json({ status: updated.presenceStatus });
}
