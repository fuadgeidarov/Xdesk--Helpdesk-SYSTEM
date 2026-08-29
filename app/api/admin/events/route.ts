import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, jsonError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return jsonError("Доступ запрещен", 403);

  const rawTake = Number(req.nextUrl.searchParams.get("take") || 50);
  const take = Number.isFinite(rawTake) ? Math.min(200, Math.max(1, Math.floor(rawTake))) : 50;

  const [events, total, since24h] = await Promise.all([
    prisma.authEvent.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.authEvent.count(),
    prisma.authEvent.count({
      where: { createdAt: { gte: new Date(Date.now() - 86400000) } },
    }),
  ]);

  return NextResponse.json({ events, total, since24h });
}
