import { NextRequest, NextResponse } from "next/server";
import { Prisma, TicketStatus } from "@prisma/client";
import { getSessionUser, isStaff, jsonError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { priorityLabels, statusLabels } from "@/lib/labels";
import { buildXlsx, type XlsxSheet } from "@/lib/xlsx";
import { checkRateLimit } from "@/lib/rate-limit";

const statuses: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED", "CLOSED"];
type ReportKind = "employees" | "ratings" | "tickets" | "all";

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function getRange(range: string, from?: string, to?: string) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "today") return { start: today, end: addDays(today, 1), label: "Сегодня" };
  if (range === "7d") return { start: addDays(today, -6), end: addDays(today, 1), label: "Последние 7 дней" };
  if (range === "month") {
    return {
      start: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
      end: addDays(today, 1),
      label: "Текущий месяц",
    };
  }
  if (range === "custom" && from && to) {
    const start = new Date(`${from}T00:00:00Z`);
    const end = addDays(new Date(`${to}T00:00:00Z`), 1);
    const spanDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < end && spanDays <= 366) {
      return { start, end, label: `${from} — ${to}` };
    }
  }
  return { start: addDays(today, -29), end: addDays(today, 1), label: "Последние 30 дней" };
}

function formatMinutes(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 60) return `${Math.round(value)} мин`;
  if (value < 1440) return `${(value / 60).toFixed(1)} ч`;
  return `${(value / 1440).toFixed(1)} дн`;
}

function safeReport(value: string | null): ReportKind {
  return value === "employees" || value === "ratings" || value === "tickets" || value === "all" ? value : "all";
}

function safeFilenamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-zа-яё0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45) || "report";
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  if (!isStaff(user.role)) return jsonError("Только для IT", 403);
  const exportLimit = checkRateLimit(`analytics-export:${user.id}`, 10, 60_000);
  if (!exportLimit.allowed) {
    return NextResponse.json(
      { error: "Слишком много выгрузок. Повторите позже." },
      { status: 429, headers: { "Retry-After": String(exportLimit.retryAfterSeconds) } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const report = safeReport(sp.get("report"));
  const statusValue = sp.get("status") || "ALL";
  const status = statuses.includes(statusValue as TicketStatus) ? (statusValue as TicketStatus) : "ALL";
  const agent = sp.get("agent") || "";
  const ratingValue = sp.get("rating") || "ALL";
  const selectedRating = ["1", "2", "3", "4", "5"].includes(ratingValue) ? Number(ratingValue) : null;
  const period = getRange(sp.get("range") || "30d", sp.get("from") || undefined, sp.get("to") || undefined);

  const selectedAgent = agent
    ? await prisma.user.findFirst({
        where: { id: agent, isActive: true, role: { in: ["AGENT", "ADMIN"] } },
        select: { id: true, name: true },
      })
    : null;
  if (agent && !selectedAgent) return jsonError("IT-сотрудник не найден", 404);

  const ticketWhere: Prisma.TicketWhereInput = {
    createdAt: { gte: period.start, lt: period.end },
    ...(selectedAgent ? { assigneeId: selectedAgent.id } : {}),
    ...(status !== "ALL" ? { status } : {}),
    ...(selectedRating ? { rating: { is: { score: selectedRating } } } : {}),
  };

  const ratingWhere: Prisma.RatingWhereInput = {
    createdAt: { gte: period.start, lt: period.end },
    ...(selectedAgent ? { agentId: selectedAgent.id } : {}),
    ...(selectedRating ? { score: selectedRating } : {}),
  };

  const [tickets, staff, statusGroups, closedGroups, ratingGroups, resolutionRows, firstReplyRows, ratings] = await Promise.all([
    prisma.ticket.findMany({
      where: ticketWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10000,
      select: {
        id: true,
        number: true,
        title: true,
        category: true,
        status: true,
        priority: true,
        store: true,
        createdAt: true,
        closedAt: true,
        lastActivityAt: true,
        author: { select: { name: true } },
        assignee: { select: { id: true, name: true } },
        rating: { select: { score: true, comment: true, createdAt: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: ["AGENT", "ADMIN"] }, isActive: true },
      select: { id: true, name: true, department: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.ticket.groupBy({
      by: ["assigneeId", "status"],
      where: { assigneeId: { not: null } },
      _count: { _all: true },
    }),
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: { assigneeId: { not: null }, closedAt: { gte: period.start, lt: period.end } },
      _count: { _all: true },
    }),
    prisma.rating.groupBy({
      by: ["agentId"],
      where: { createdAt: { gte: period.start, lt: period.end } },
      _avg: { score: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ assigneeId: string; avgMinutes: number | null }>>`
      SELECT "assigneeId" AS "assigneeId",
             AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 60.0) AS "avgMinutes"
      FROM "Ticket"
      WHERE "assigneeId" IS NOT NULL
        AND "closedAt" >= ${period.start}
        AND "closedAt" < ${period.end}
        AND "closedAt" IS NOT NULL
      GROUP BY "assigneeId"
    `,
    prisma.$queryRaw<Array<{ assigneeId: string; avgMinutes: number | null }>>`
      SELECT t."assigneeId" AS "assigneeId",
             AVG(EXTRACT(EPOCH FROM (first_reply."createdAt" - t."createdAt")) / 60.0) AS "avgMinutes"
      FROM "Ticket" t
      JOIN LATERAL (
        SELECT c."createdAt"
        FROM "Comment" c
        JOIN "User" u ON u.id = c."authorId"
        WHERE c."ticketId" = t.id
          AND c."isInternal" = false
          AND u.role IN ('AGENT', 'ADMIN')
          AND c."createdAt" >= t."createdAt"
        ORDER BY c."createdAt" ASC, c.id ASC
        LIMIT 1
      ) first_reply ON true
      WHERE t."assigneeId" IS NOT NULL
        AND t."createdAt" >= ${period.start}
        AND t."createdAt" < ${period.end}
      GROUP BY t."assigneeId"
    `,
    prisma.rating.findMany({
      where: ratingWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10000,
      select: {
        score: true,
        comment: true,
        createdAt: true,
        agent: { select: { id: true, name: true } },
        ticket: { select: { number: true, title: true, category: true, store: true, status: true, priority: true } },
      },
    }),
  ]);

  const statusMap = new Map<string, { open: number; inProgress: number; waiting: number; resolved: number }>();
  for (const row of statusGroups) {
    if (!row.assigneeId) continue;
    const current = statusMap.get(row.assigneeId) || { open: 0, inProgress: 0, waiting: 0, resolved: 0 };
    if (row.status === "OPEN") current.open = row._count._all;
    if (row.status === "IN_PROGRESS") current.inProgress = row._count._all;
    if (row.status === "WAITING_RESPONSE") current.waiting = row._count._all;
    if (row.status === "RESOLVED") current.resolved = row._count._all;
    statusMap.set(row.assigneeId, current);
  }
  const closedMap = new Map(closedGroups.map((row) => [row.assigneeId!, row._count._all]));
  const ratingMap = new Map(ratingGroups.map((row) => [row.agentId, { avg: row._avg.score, count: row._count._all }]));
  const resolutionMap = new Map(resolutionRows.map((row) => [row.assigneeId, row.avgMinutes == null ? null : Number(row.avgMinutes)]));
  const firstReplyMap = new Map(firstReplyRows.map((row) => [row.assigneeId, row.avgMinutes == null ? null : Number(row.avgMinutes)]));

  const filterParts = [
    selectedAgent ? `сотрудник: ${selectedAgent.name}` : "все сотрудники",
    status !== "ALL" ? `статус: ${statusLabels[status]}` : "все статусы",
    selectedRating ? `оценка: ${selectedRating}` : "все оценки",
  ];
  const filterLabel = filterParts.join(" · ");
  const meta = `Сформировал: ${user.name} · ${new Date().toLocaleString("ru-RU")}`;
  const sheets: XlsxSheet[] = [];

  if (report === "employees" || report === "all") {
    const rows = staff
      .filter((item) => !selectedAgent || item.id === selectedAgent.id)
      .map((member) => {
        const current = statusMap.get(member.id) || { open: 0, inProgress: 0, waiting: 0, resolved: 0 };
        const rating = ratingMap.get(member.id);
        return [
          member.name,
          member.department || "IT",
          member.role === "ADMIN" ? "Администратор" : "IT-агент",
          current.open,
          current.inProgress,
          current.waiting,
          current.resolved,
          current.open + current.inProgress + current.waiting + current.resolved,
          closedMap.get(member.id) || 0,
          formatMinutes(firstReplyMap.get(member.id) ?? null),
          formatMinutes(resolutionMap.get(member.id) ?? null),
          rating?.avg == null ? null : Number(Number(rating.avg).toFixed(2)),
          rating?.count || 0,
        ];
      });
    sheets.push({
      name: "По сотрудникам",
      title: "Xdesk · Аналитика по сотрудникам",
      subtitle: `Период: ${period.label} · ${filterLabel}`,
      meta,
      columns: [
        { header: "Сотрудник", width: 32 }, { header: "Отдел", width: 20 }, { header: "Роль", width: 18 },
        { header: "Открытые", width: 14 }, { header: "В работе", width: 14 }, { header: "Ждёт ответа", width: 15 },
        { header: "Решены", width: 13 }, { header: "Незакрытые всего", width: 19 }, { header: "Закрыто за период", width: 19 },
        { header: "Первый ответ", width: 18 }, { header: "Среднее решение", width: 20 }, { header: "Средняя оценка", width: 18 },
        { header: "Количество оценок", width: 20 },
      ],
      rows,
    });
  }

  if (report === "ratings" || report === "all") {
    sheets.push({
      name: "По оценкам",
      title: "Xdesk · Аналитика по оценкам",
      subtitle: `Период: ${period.label} · ${filterLabel}`,
      meta,
      columns: [
        { header: "Оценка", width: 12 }, { header: "№ заявки", width: 14 }, { header: "Заявка", width: 44 },
        { header: "Сотрудник", width: 30 }, { header: "Категория", width: 22 }, { header: "Магазин", width: 20 },
        { header: "Статус", width: 18 }, { header: "Приоритет", width: 16 }, { header: "Комментарий пользователя", width: 50 },
        { header: "Дата оценки", width: 22 },
      ],
      rows: ratings.map((rating) => [
        rating.score, rating.ticket.number, rating.ticket.title, rating.agent.name, rating.ticket.category, rating.ticket.store || "",
        statusLabels[rating.ticket.status], priorityLabels[rating.ticket.priority], rating.comment || "", rating.createdAt,
      ]),
    });
  }

  if (report === "tickets" || report === "all") {
    sheets.push({
      name: "Все заявки",
      title: "Xdesk · Все заявки",
      subtitle: `Период: ${period.label} · ${filterLabel}`,
      meta,
      columns: [
        { header: "№", width: 11 }, { header: "Заявка", width: 44 }, { header: "Категория", width: 22 },
        { header: "Магазин", width: 20 }, { header: "Статус", width: 18 }, { header: "Приоритет", width: 16 },
        { header: "Автор", width: 28 }, { header: "Исполнитель", width: 28 }, { header: "Создана", width: 22 },
        { header: "Закрыта", width: 22 }, { header: "Последняя активность", width: 24 }, { header: "Оценка", width: 12 },
        { header: "Комментарий к оценке", width: 46 },
      ],
      rows: tickets.map((ticket) => [
        ticket.number, ticket.title, ticket.category, ticket.store || "", statusLabels[ticket.status], priorityLabels[ticket.priority],
        ticket.author?.name || "Гость", ticket.assignee?.name || "Не назначен", ticket.createdAt, ticket.closedAt,
        ticket.lastActivityAt, ticket.rating?.score ?? null, ticket.rating?.comment || "",
      ]),
    });
  }

  const buffer = await buildXlsx(sheets, "Xdesk");

  const reportLabel = report === "employees" ? "employees" : report === "ratings" ? "ratings" : report === "tickets" ? "tickets" : "full";
  const agentPart = selectedAgent ? `-${safeFilenamePart(selectedAgent.name)}` : "";
  const filename = `xdesk-analytics-${reportLabel}${agentPart}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
