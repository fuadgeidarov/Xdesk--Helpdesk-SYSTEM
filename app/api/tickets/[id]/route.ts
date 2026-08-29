import { NextRequest, NextResponse } from "next/server";
import { TicketStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isStaff, jsonError } from "@/lib/auth";
import { cacheDelete } from "@/lib/cache";
import { deleteStoredFile } from "@/lib/storage";
import { notifyTelegramStatus } from "@/lib/telegram";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { author: { select: { id: true, name: true, email: true, department: true } }, assignee: { select: { id: true, name: true, email: true } }, attachments: true, rating: true },
  });
  if (!ticket) return jsonError("Заявка не найдена", 404);
  if (!isStaff(user.role) && ticket.authorId !== user.id) return jsonError("Нет доступа", 403);
  return NextResponse.json(ticket, { headers: { "Cache-Control": "no-store" } });
}

const patchSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED", "CLOSED"]).optional(),
  assigneeId: z.string().nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  if (!isStaff(user.role)) return jsonError("Только IT может менять заявку", 403);
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Некорректные данные");
  const existing = await prisma.ticket.findUnique({ where: { id }, select: { id: true, status: true, assigneeId: true, closedAt: true } });
  if (!existing) return jsonError("Заявка не найдена", 404);

  if (existing.status === "CLOSED" && parsed.data.status && parsed.data.status !== "CLOSED" && user.role !== "ADMIN") {
    return jsonError("Закрытую заявку может открыть повторно только администратор", 403);
  }
  if (parsed.data.assigneeId) {
    const assignee = await prisma.user.findFirst({ where: { id: parsed.data.assigneeId, isActive: true, isBlocked: false, role: { in: ["AGENT", "ADMIN"] } }, select: { id: true } });
    if (!assignee) return jsonError("Исполнителем может быть только активный сотрудник IT-поддержки", 400);
  }

  const data: { status?: TicketStatus; assigneeId?: string | null; priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; closedAt?: Date | null; lastActivityAt?: Date } = {};
  if (parsed.data.status) {
    data.status = parsed.data.status;
    data.closedAt = parsed.data.status === "CLOSED" ? (existing.closedAt ?? new Date()) : null;
    data.lastActivityAt = new Date();
    if (parsed.data.status === "CLOSED" && !existing.assigneeId && parsed.data.assigneeId === undefined) data.assigneeId = user.id;
  }
  if (parsed.data.assigneeId !== undefined) data.assigneeId = parsed.data.assigneeId;
  if (parsed.data.priority) data.priority = parsed.data.priority;
  if (parsed.data.status === "IN_PROGRESS" && !existing.assigneeId && data.assigneeId === undefined) data.assigneeId = user.id;

  const ticket = await prisma.ticket.update({ where: { id }, data, include: { author: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, rating: true } });
  cacheDelete("analytics:closed");
  if (parsed.data.status && parsed.data.status !== existing.status && ticket.source === "TELEGRAM" && ticket.telegramChatId) {
    notifyTelegramStatus({
      id: ticket.id, number: ticket.number, title: ticket.title, source: ticket.source, telegramChatId: ticket.telegramChatId, status: ticket.status,
    }).catch((error) => console.error("[Telegram] Failed to deliver status update:", error));
  }
  return NextResponse.json(ticket);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  if (user.role !== "ADMIN") return jsonError("Удалять заявки может только администратор", 403);
  const { id } = await ctx.params;
  const existing = await prisma.ticket.findUnique({ where: { id }, select: { id: true, number: true, attachments: { select: { storedName: true } }, comments: { select: { attachments: { select: { storedName: true } } } } } });
  if (!existing) return jsonError("Заявка не найдена", 404);
  const storedNames = [...existing.attachments.map((a) => a.storedName), ...existing.comments.flatMap((comment) => comment.attachments.map((a) => a.storedName))];
  await prisma.ticket.delete({ where: { id } });
  await Promise.allSettled(storedNames.map(deleteStoredFile));
  cacheDelete("analytics:closed");
  return NextResponse.json({ ok: true, number: existing.number });
}
