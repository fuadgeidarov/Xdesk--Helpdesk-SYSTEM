import { NextRequest, NextResponse } from "next/server";
import { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isStaff, jsonError } from "@/lib/auth";

const statuses: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED", "CLOSED"];

function rangeDates(range: string, from?: string, to?: string) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const add = (d: Date, days: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + days); return x; };
  if (range === "today") return { start: today, end: add(today, 1) };
  if (range === "7d") return { start: add(today, -6), end: add(today, 1) };
  if (range === "month") return { start: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), end: add(today, 1) };
  if (range === "custom" && from && to) {
    const start = new Date(`${from}T00:00:00Z`); const end = add(new Date(`${to}T00:00:00Z`), 1);
    const spanDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < end && spanDays <= 366) return { start, end };
  }
  return { start: add(today, -29), end: add(today, 1) };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  if (!isStaff(user.role)) return jsonError("Только для IT", 403);

  const sp = req.nextUrl.searchParams;
  const agent = sp.get("agent") || "";
  const statusValue = sp.get("status") || "ALL";
  const status = statuses.includes(statusValue as TicketStatus) ? (statusValue as TicketStatus) : "ALL";
  const ratingValue = sp.get("rating") || "ALL";
  const rating = ["1", "2", "3", "4", "5"].includes(ratingValue) ? Number(ratingValue) : null;
  const pageRaw = Number(sp.get("page") || "1");
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const limitRaw = Number(sp.get("limit") || "100");
  const take = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 100;
  const period = rangeDates(sp.get("range") || "30d", sp.get("from") || undefined, sp.get("to") || undefined);

  const filteredWhere: Prisma.TicketWhereInput = {
    createdAt: { gte: period.start, lt: period.end },
    ...(agent ? { assigneeId: agent } : {}),
    ...(status !== "ALL" ? { status } : {}),
    ...(rating ? { rating: { is: { score: rating } } } : {}),
  };

  const [total, byStatus, byPriority, created, closed, messages, backlog, unassigned, tickets, agents, ratingsByScore] = await Promise.all([
    prisma.ticket.count(),
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
    prisma.ticket.count({ where: { createdAt: { gte: period.start, lt: period.end } } }),
    prisma.ticket.count({ where: { closedAt: { gte: period.start, lt: period.end } } }),
    prisma.comment.count({ where: { createdAt: { gte: period.start, lt: period.end } } }),
    prisma.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED"] } } }),
    prisma.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED"] }, assigneeId: null } }),
    prisma.ticket.findMany({ where: filteredWhere, take, skip: (page - 1) * take, orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }], select: { id: true, number: true, title: true, status: true, priority: true, assignee: { select: { id: true, name: true } } } }),
    prisma.user.findMany({ where: { role: { in: ["AGENT", "ADMIN"] }, isActive: true }, select: { id: true, name: true, department: true }, orderBy: { name: "asc" } }),
    prisma.rating.groupBy({ by: ["score"], where: { createdAt: { gte: period.start, lt: period.end } }, _count: { _all: true } }),
  ]);

  return NextResponse.json({ access: user.role, period, filters: { agent, status, rating, page, limit: take }, total, created, closed, messages, backlog, unassigned, byStatus, byPriority, ratingsByScore, agents, tickets });
}
