export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma, TicketStatus, Priority } from "@prisma/client";
import { getSessionUser, isStaff } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, priorityLabels, statusLabels } from "@/lib/labels";
import { PriorityBadge, StatusBadge } from "@/components/Badges";

const PAGE_SIZE = 100;
const statusOrder: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED", "CLOSED"];
const priorityOrder: Priority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const statusColors: Record<TicketStatus, string> = {
  OPEN: "#00b8ff",
  IN_PROGRESS: "#ffb020",
  WAITING_RESPONSE: "#8799a1",
  RESOLVED: "#20a76d",
  CLOSED: "#60726d",
};
const priorityColors: Record<Priority, string> = {
  CRITICAL: "#ef476f",
  HIGH: "#ff7a45",
  MEDIUM: "#f2b84b",
  LOW: "#4aa3df",
};

type RangeKey = "today" | "7d" | "30d" | "month" | "custom";

type SearchParams = {
  agent?: string;
  status?: string;
  rating?: string;
  view?: string;
  page?: string;
  range?: string;
  from?: string;
  to?: string;
};

function parsePage(value: string | undefined) {
  const n = Number(value || "1");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function safeStatus(value: string | undefined): TicketStatus | "ALL" {
  return value && statusOrder.includes(value as TicketStatus) ? (value as TicketStatus) : "ALL";
}

function safeRange(value: string | undefined): RangeKey {
  return value === "today" || value === "7d" || value === "30d" || value === "month" || value === "custom" ? value : "30d";
}

function dateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number) {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getRange(range: RangeKey, fromRaw?: string, toRaw?: string) {
  const now = new Date();
  const today = startOfUtcDay(now);
  if (range === "today") return { start: today, end: addUtcDays(today, 1), label: "Сегодня" };
  if (range === "7d") return { start: addUtcDays(today, -6), end: addUtcDays(today, 1), label: "Последние 7 дней" };
  if (range === "month") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { start, end: addUtcDays(today, 1), label: "Текущий месяц" };
  }
  if (range === "custom" && fromRaw && toRaw) {
    const start = new Date(`${fromRaw}T00:00:00Z`);
    const end = addUtcDays(new Date(`${toRaw}T00:00:00Z`), 1);
    const spanDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < end && spanDays <= 366) {
      return { start, end, label: `${fromRaw} — ${toRaw}` };
    }
  }
  return { start: addUtcDays(today, -29), end: addUtcDays(today, 1), label: "Последние 30 дней" };
}

function makeQuery(params: Partial<SearchParams>) {
  const sp = new URLSearchParams();
  const values: SearchParams = { range: "30d", ...params };
  if (values.agent) sp.set("agent", values.agent);
  if (values.status && values.status !== "ALL") sp.set("status", values.status);
  if (values.rating && values.rating !== "ALL") sp.set("rating", values.rating);
  if (values.view && values.view !== "employees") sp.set("view", values.view);
  if (values.range && values.range !== "30d") sp.set("range", values.range);
  if (values.from) sp.set("from", values.from);
  if (values.to) sp.set("to", values.to);
  if (values.page && Number(values.page) > 1) sp.set("page", String(values.page));
  const query = sp.toString();
  return query ? `/analytics?${query}` : "/analytics";
}

function formatDuration(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  const h = minutes / 60;
  if (h < 24) return `${h.toFixed(1)} ч`;
  return `${(h / 24).toFixed(1)} дн`;
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function linePoints(values: number[], width = 720, height = 190, padding = 18) {
  const max = Math.max(...values, 1);
  return values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : padding + (i * (width - padding * 2)) / (values.length - 1);
    const y = height - padding - (v / max) * (height - padding * 2);
    return { x, y, v };
  });
}

function smoothPath(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/");

  const params = await searchParams;
  const selectedAgent = params.agent || "";
  const selectedStatus = safeStatus(params.status);
  const selectedRating = params.rating && ["ALL", "5", "4", "3", "2", "1"].includes(params.rating) ? params.rating : "ALL";
  const activeView = params.view === "ratings" || params.view === "tickets" ? params.view : "employees";
  const requestedPage = parsePage(params.page);
  const range = safeRange(params.range);
  const period = getRange(range, params.from, params.to);
  const periodStart = period.start;
  const periodEnd = period.end;

  const ticketWhere: Prisma.TicketWhereInput = {
    createdAt: { gte: periodStart, lt: periodEnd },
    ...(selectedAgent ? { assigneeId: selectedAgent } : {}),
    ...(selectedStatus !== "ALL" ? { status: selectedStatus } : {}),
    ...(selectedRating !== "ALL" ? { rating: { is: { score: Number(selectedRating) } } } : {}),
  };
  const periodCreatedWhere: Prisma.TicketWhereInput = { createdAt: { gte: periodStart, lt: periodEnd } };
  const periodClosedWhere: Prisma.TicketWhereInput = { closedAt: { gte: periodStart, lt: periodEnd } };

  type AgentMetric = {
    id: string; name: string; department: string | null;
    openNow: number; inProgressNow: number; waitingNow: number; resolvedNow: number; closedInPeriod: number; createdInPeriod: number;
    totalHandled: number; avgResolutionMinutes: number | null; avgFirstResponseMinutes: number | null;
    ratingAvg: number | null; ratedCount: number;
  };
  type TrendRow = { bucket: Date; created: number; closed: number };
  type FirstResponseRow = { id: string; firstResponseMinutes: number | null };

  const [
    totalTickets,
    statusGroups,
    priorityGroups,
    periodCreated,
    periodClosed,
    periodMessages,
    currentOpenCritical,
    unassignedOpen,
    agentCount,
    filteredCount,
    filteredTickets,
    agents,
    ratings,
    trend,
    firstResponseRows,
    resolutionAvg,
    categoryGroups,
  ] = await Promise.all([
    prisma.ticket.count(),
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
    prisma.ticket.count({ where: periodCreatedWhere }),
    prisma.ticket.count({ where: periodClosedWhere }),
    prisma.comment.count({ where: { createdAt: { gte: periodStart, lt: periodEnd } } }),
    prisma.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED"] }, priority: "CRITICAL" } }),
    prisma.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_RESPONSE", "RESOLVED"] }, assigneeId: null } }),
    prisma.user.count({ where: { role: { in: ["AGENT", "ADMIN"] }, isActive: true } }),
    prisma.ticket.count({ where: ticketWhere }),
    prisma.ticket.findMany({
      where: ticketWhere,
      take: PAGE_SIZE,
      skip: (requestedPage - 1) * PAGE_SIZE,
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
      select: {
        id: true, number: true, title: true, status: true, priority: true, category: true,
        createdAt: true, lastActivityAt: true, closedAt: true,
        author: { select: { name: true } },
        assignee: { select: { id: true, name: true } },
        rating: { select: { score: true, comment: true, createdAt: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: ["AGENT", "ADMIN"] }, isActive: true },
      select: { id: true, name: true, department: true },
      orderBy: { name: "asc" },
    }),
    prisma.rating.groupBy({ by: ["agentId"], where: { createdAt: { gte: periodStart, lt: periodEnd } }, _avg: { score: true }, _count: { _all: true } }),
    prisma.$queryRaw<TrendRow[]>`
      SELECT date_trunc('day', t."createdAt") AS bucket,
             COUNT(*)::int AS created,
             0::int AS closed
      FROM "Ticket" t
      WHERE t."createdAt" >= ${periodStart} AND t."createdAt" < ${periodEnd}
      GROUP BY 1
      UNION ALL
      SELECT date_trunc('day', t."closedAt") AS bucket,
             0::int AS created,
             COUNT(*)::int AS closed
      FROM "Ticket" t
      WHERE t."closedAt" >= ${periodStart} AND t."closedAt" < ${periodEnd}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<FirstResponseRow[]>`
      SELECT t.id,
        EXTRACT(EPOCH FROM (MIN(c."createdAt") - t."createdAt")) / 60.0 AS "firstResponseMinutes"
      FROM "Ticket" t
      LEFT JOIN "Comment" c ON c."ticketId" = t.id
      LEFT JOIN "User" u ON u.id = c."authorId"
      WHERE t."closedAt" >= ${periodStart} AND t."closedAt" < ${periodEnd}
        AND c."createdAt" >= t."createdAt"
        AND c."isInternal" = false
        AND u.role IN ('AGENT', 'ADMIN')
      GROUP BY t.id, t."createdAt"
    `,
    prisma.$queryRaw<Array<{ avgMinutes: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM (t."closedAt" - t."createdAt")) / 60.0) AS "avgMinutes"
      FROM "Ticket" t
      WHERE t."closedAt" >= ${periodStart} AND t."closedAt" < ${periodEnd}
        AND t."closedAt" IS NOT NULL
    `,
    prisma.ticket.groupBy({ by: ["category"], where: periodCreatedWhere, _count: { _all: true } }),
  ]);

  // Keep score aggregation and rated-ticket rows in a dedicated tuple.
  // This avoids accidental positional mismatches with the large analytics Promise.all above.
  const [ratingScoreGroups, ratingTickets] = await Promise.all([
    prisma.rating.groupBy({
      by: ["score"],
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
      _count: { _all: true },
    }),
    prisma.ticket.findMany({
      where: {
        rating: {
          is: {
            createdAt: { gte: periodStart, lt: periodEnd },
            ...(selectedRating !== "ALL" ? { score: Number(selectedRating) } : {}),
          },
        },
        ...(selectedAgent ? { assigneeId: selectedAgent } : {}),
      },
      take: 100,
      orderBy: { lastActivityAt: "desc" },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        rating: { select: { score: true, comment: true, createdAt: true } },
        assignee: { select: { id: true, name: true } },
        author: { select: { name: true } },
      },
    }),
  ]);

  const statusMap = new Map(statusGroups.map((item) => [item.status, item._count._all]));
  const statusCounts = statusOrder.map((status) => ({ status, count: statusMap.get(status) || 0 }));
  const priorityMap = new Map(priorityGroups.map((item) => [item.priority, item._count._all]));
  const priorityCounts = priorityOrder.map((priority) => ({ priority, count: priorityMap.get(priority) || 0 }));
  const ratingScoreMap = new Map(ratingScoreGroups.map((row) => [row.score, row._count._all]));
  const ratingDistribution = [5, 4, 3, 2, 1].map((score) => ({ score, count: ratingScoreMap.get(score) || 0 }));
  const ratingTotal = ratingDistribution.reduce((sum, row) => sum + row.count, 0);
  const ratingAverage = ratingTotal ? ratingDistribution.reduce((sum, row) => sum + row.score * row.count, 0) / ratingTotal : null;
  const totalCurrent = Math.max(totalTickets, 1);
  const backlog = (statusMap.get("OPEN") || 0) + (statusMap.get("IN_PROGRESS") || 0) + (statusMap.get("WAITING_RESPONSE") || 0) + (statusMap.get("RESOLVED") || 0);
  const closureRate = periodCreated ? percent(periodClosed, periodCreated) : 0;
  const avgResolutionMinutes = resolutionAvg[0]?.avgMinutes == null ? null : Number(resolutionAvg[0].avgMinutes);
  const firstResponseValid = firstResponseRows.filter((x) => x.firstResponseMinutes != null);
  const firstResponseMinutes = firstResponseValid.length ? firstResponseValid.reduce((sum, x) => sum + Number(x.firstResponseMinutes), 0) / firstResponseValid.length : null;

  const [agentStatusGroups, agentClosedGroups, agentCreatedGroups, agentHandledGroups, agentResolutionRows, agentFirstReplyRows] = await Promise.all([
    prisma.ticket.groupBy({ by: ["assigneeId", "status"], where: { assigneeId: { not: null } }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["assigneeId"], where: { assigneeId: { not: null }, closedAt: { gte: periodStart, lt: periodEnd } }, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["assigneeId"], where: { assigneeId: { not: null }, createdAt: { gte: periodStart, lt: periodEnd } }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ assigneeId: string; handled: number }>>`
      SELECT t."assigneeId" AS "assigneeId", COUNT(*)::int AS handled
      FROM "Ticket" t
      WHERE t."assigneeId" IS NOT NULL
        AND (t."createdAt" >= ${periodStart} AND t."createdAt" < ${periodEnd}
             OR t."closedAt" >= ${periodStart} AND t."closedAt" < ${periodEnd})
      GROUP BY t."assigneeId"
    `,
    prisma.$queryRaw<Array<{ assigneeId: string; avgMinutes: number | null }>>`
      SELECT "assigneeId" AS "assigneeId", AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 60.0) AS "avgMinutes"
      FROM "Ticket"
      WHERE "assigneeId" IS NOT NULL AND "closedAt" >= ${periodStart} AND "closedAt" < ${periodEnd} AND "closedAt" IS NOT NULL
      GROUP BY "assigneeId"
    `,
    prisma.$queryRaw<Array<{ assigneeId: string; avgMinutes: number | null }>>`
      SELECT t."assigneeId" AS "assigneeId", AVG(EXTRACT(EPOCH FROM (first_reply."createdAt" - t."createdAt")) / 60.0) AS "avgMinutes"
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
      WHERE t."assigneeId" IS NOT NULL AND t."createdAt" >= ${periodStart} AND t."createdAt" < ${periodEnd}
      GROUP BY t."assigneeId"
    `,
  ]);

  const ratingMap = new Map(ratings.map((r) => [r.agentId, { avg: r._avg.score, count: r._count._all }]));
  const statusMetricMap = new Map<string, { OPEN: number; IN_PROGRESS: number; WAITING_RESPONSE: number; RESOLVED: number }>();
  for (const row of agentStatusGroups) {
    if (!row.assigneeId || row.status === "CLOSED") continue;
    const current = statusMetricMap.get(row.assigneeId) || { OPEN: 0, IN_PROGRESS: 0, WAITING_RESPONSE: 0, RESOLVED: 0 };
    current[row.status] = row._count._all;
    statusMetricMap.set(row.assigneeId, current);
  }
  const closedMap = new Map(agentClosedGroups.map((row) => [row.assigneeId!, row._count._all]));
  const createdMap = new Map(agentCreatedGroups.map((row) => [row.assigneeId!, row._count._all]));
  const handledMap = new Map(agentHandledGroups.map((row) => [row.assigneeId, Number(row.handled)]));
  const resolutionMap = new Map(agentResolutionRows.map((row) => [row.assigneeId, row.avgMinutes == null ? null : Number(row.avgMinutes)]));
  const firstReplyMap = new Map(agentFirstReplyRows.map((row) => [row.assigneeId, row.avgMinutes == null ? null : Number(row.avgMinutes)]));
  const agentMetrics: AgentMetric[] = agents.map((agent) => {
    const current = statusMetricMap.get(agent.id) || { OPEN: 0, IN_PROGRESS: 0, WAITING_RESPONSE: 0, RESOLVED: 0 };
    const rating = ratingMap.get(agent.id);
    return {
      id: agent.id, name: agent.name, department: agent.department,
      openNow: current.OPEN, inProgressNow: current.IN_PROGRESS, waitingNow: current.WAITING_RESPONSE, resolvedNow: current.RESOLVED, closedInPeriod: closedMap.get(agent.id) || 0,
      createdInPeriod: createdMap.get(agent.id) || 0, totalHandled: handledMap.get(agent.id) || 0,
      avgResolutionMinutes: resolutionMap.get(agent.id) ?? null,
      avgFirstResponseMinutes: firstReplyMap.get(agent.id) ?? null,
      ratingAvg: rating?.avg ?? null, ratedCount: rating?.count || 0,
    };
  });

  agentMetrics.sort((a, b) => b.totalHandled - a.totalHandled || b.closedInPeriod - a.closedInPeriod || a.name.localeCompare(b.name, "ru"));

  const trendMap = new Map<string, { date: string; created: number; closed: number }>();
  for (const row of trend) {
    const key = dateOnly(new Date(row.bucket));
    const current = trendMap.get(key) || { date: key, created: 0, closed: 0 };
    current.created += Number(row.created);
    current.closed += Number(row.closed);
    trendMap.set(key, current);
  }
  const trendDays = [];
  for (let d = startOfUtcDay(periodStart); d < periodEnd; d = addUtcDays(d, 1)) {
    const key = dateOnly(d);
    trendDays.push(trendMap.get(key) || { date: key, created: 0, closed: 0 });
  }
  const trendCreated = linePoints(trendDays.map((x) => x.created));
  const trendClosed = linePoints(trendDays.map((x) => x.closed));
  const trendStep = Math.max(1, Math.ceil(trendDays.length / 8));

  const filteredTotalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, filteredTotalPages);
  if (requestedPage !== currentPage) redirect(makeQuery({ ...params, page: String(currentPage) }));
  const from = filteredCount ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(currentPage * PAGE_SIZE, filteredCount);

  const donut = (() => {
    let start = 0;
    const slices = statusCounts.map(({ status, count }) => {
      const end = start + (count / totalCurrent) * 100;
      const slice = `${statusColors[status]} ${start}% ${end}%`;
      start = end;
      return slice;
    });
    return `conic-gradient(${slices.join(", ")})`;
  })();

  const overallRating = ratings.length
    ? ratings.reduce((sum, r) => sum + Number(r._avg.score || 0) * r._count._all, 0) / ratings.reduce((sum, r) => sum + r._count._all, 0)
    : null;
  const currentCriticalPercent = percent(currentOpenCritical, backlog);

  const exportBase = new URLSearchParams();
  exportBase.set("range", range);
  if (selectedAgent) exportBase.set("agent", selectedAgent);
  if (selectedStatus !== "ALL") exportBase.set("status", selectedStatus);
  if (selectedRating !== "ALL") exportBase.set("rating", selectedRating);
  if (params.from) exportBase.set("from", params.from);
  if (params.to) exportBase.set("to", params.to);
  const exportHref = (report: "employees" | "ratings" | "tickets" | "all") => {
    const query = new URLSearchParams(exportBase);
    query.set("report", report);
    return `/api/analytics/export?${query.toString()}`;
  };

  return (
    <section className="section analytics-page" style={{ paddingTop: "1.5rem" }}>
      <div className="section-head analytics-head">
        <div>
          <div className="analytics-kicker">IT Operations · {period.label}</div>
          <h2>Аналитика IT-отдела</h2>
          <p>Полная картина нагрузки: поток заявок, очередь, работа сотрудников, скорость ответа и решения.</p>
        </div>
        <div className="analytics-access"><span className="access-dot" /> {user.role === "ADMIN" ? "Администратор" : "IT-специалист"}</div>
      </div>

      <div className="card analytics-filter-card analytics-period-card">
        <div className="analytics-filter-head">
          <div><h3>Период и срез</h3><p>Поток и показатели эффективности считаются за период; текущая очередь показывается отдельно.</p></div>
          <Link href="/analytics" className="btn btn-secondary">Сбросить</Link>
        </div>
        <div className="analytics-period-buttons">
          {([['today', 'Сегодня'], ['7d', '7 дней'], ['30d', '30 дней'], ['month', 'Текущий месяц']] as [RangeKey, string][]).map(([key, label]) => (
            <Link key={key} href={makeQuery({ ...params, range: key, page: "1" })} className={`analytics-filter-chip ${range === key ? "active" : ""}`}>{label}</Link>
          ))}
        </div>
        <form className="analytics-custom-range" method="get">
          <input type="hidden" name="range" value="custom" />
          <label>От <input type="date" name="from" defaultValue={params.from || dateOnly(period.start)} /></label>
          <label>До <input type="date" name="to" defaultValue={params.to || dateOnly(addUtcDays(period.end, -1))} /></label>
          {selectedAgent && <input type="hidden" name="agent" value={selectedAgent} />}
          {selectedStatus !== "ALL" && <input type="hidden" name="status" value={selectedStatus} />}
          {selectedRating !== "ALL" && <input type="hidden" name="rating" value={selectedRating} />}
          <button className="btn btn-secondary" type="submit">Применить период</button>
          <div className="analytics-export-menu">
            <span className="analytics-export-label">Excel-отчёт:</span>
            <a className="btn btn-secondary analytics-export" href={exportHref("employees")}>По сотрудникам</a>
            <a className="btn btn-secondary analytics-export" href={exportHref("ratings")}>По оценкам</a>
            <a className="btn btn-secondary analytics-export" href={exportHref("tickets")}>Все заявки</a>
            <a className="btn btn-primary analytics-export" href={exportHref("all")}>Полный отчёт</a>
          </div>
        </form>
      </div>

      <div className="card analytics-view-switcher">
        <div className="analytics-view-title"><span>Режим аналитики</span><small>Выберите, что смотреть прямо сейчас</small></div>
        <div className="analytics-view-tabs">
          <Link href={makeQuery({ ...params, view: "employees", page: "1" })} className={`analytics-view-tab ${activeView === "employees" ? "active" : ""}`}><strong>👥 По сотрудникам</strong><span>Нагрузка, открытые заявки и оценки</span></Link>
          <Link href={makeQuery({ ...params, view: "ratings", page: "1" })} className={`analytics-view-tab ${activeView === "ratings" ? "active" : ""}`}><strong>⭐ По оценкам</strong><span>Рейтинг и отзывы по заявкам</span></Link>
          <Link href={makeQuery({ ...params, view: "tickets", page: "1" })} className={`analytics-view-tab ${activeView === "tickets" ? "active" : ""}`}><strong>📋 Все заявки</strong><span>Полный список и фильтры</span></Link>
        </div>
      </div>

      <div className="analytics-summary-grid">
        <div className="analytics-hero-card analytics-gradient-cyan"><div className="analytics-card-label">Заявок создано</div><div className="analytics-big-number">{periodCreated}</div><div className="analytics-card-foot">За выбранный период</div></div>
        <div className="analytics-hero-card analytics-gradient-green"><div className="analytics-card-label">Заявок закрыто</div><div className="analytics-big-number">{periodClosed}</div><div className="analytics-card-foot">За выбранный период · {closureRate}% от созданных</div></div>
        <div className="analytics-hero-card analytics-gradient-violet"><div className="analytics-card-label">Текущий backlog</div><div className="analytics-big-number">{backlog}</div><div className="analytics-card-foot">Все незакрытые · критичных {currentOpenCritical}</div></div>
        <div className="analytics-hero-card analytics-gradient-orange"><div className="analytics-card-label">Среднее решение</div><div className="analytics-big-number analytics-big-number-small">{formatDuration(avgResolutionMinutes)}</div><div className="analytics-card-foot">По закрытым заявкам периода</div></div>
      </div>

      <div className="analytics-kpi-grid">
        <div className="card analytics-kpi"><span className="analytics-kpi-icon cyan">↗</span><div><strong>{periodMessages}</strong><span>сообщений за период</span></div></div>
        <div className="card analytics-kpi"><span className="analytics-kpi-icon violet">⌁</span><div><strong>{formatDuration(firstResponseMinutes)}</strong><span>средний первый ответ · закрытые заявки периода</span></div></div>
        <div className="card analytics-kpi"><span className="analytics-kpi-icon green">★</span><div><strong>{overallRating == null ? "—" : overallRating.toFixed(2)}</strong><span>средняя оценка за период</span></div></div>
        <div className="card analytics-kpi"><span className="analytics-kpi-icon orange">!</span><div><strong>{unassignedOpen}</strong><span>заявок без исполнителя</span></div></div>
      </div>

      <div className="analytics-main-grid">
        <div className="card analytics-chart-card analytics-trend-card">
          <div className="analytics-card-title-row"><div><h3>Динамика нагрузки</h3><p>Создано и закрыто заявок по дням.</p></div><span className="analytics-period-tag">{period.label}</span></div>
          <div className="analytics-legend analytics-legend-large"><span><i className="analytics-legend-line created" />Создано</span><span><i className="analytics-legend-line resolved" />Закрыто</span></div>
          <div className="analytics-line-chart">
            <svg viewBox="0 0 720 190" role="img" aria-label="Динамика созданных и закрытых заявок">
              <defs><linearGradient id="createdFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#00b8ff" stopOpacity=".30"/><stop offset="100%" stopColor="#00b8ff" stopOpacity="0"/></linearGradient><linearGradient id="closedFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#21c77a" stopOpacity=".24"/><stop offset="100%" stopColor="#21c77a" stopOpacity="0"/></linearGradient></defs>
              {[0, .25, .5, .75, 1].map((step) => <line key={step} x1="18" x2="702" y1={172 - step * 154} y2={172 - step * 154} stroke="#e8efeb" strokeWidth="1" />)}
              <path d={`${smoothPath(trendCreated)} L702,172 L18,172 Z`} fill="url(#createdFill)" />
              <path d={`${smoothPath(trendClosed)} L702,172 L18,172 Z`} fill="url(#closedFill)" />
              <path d={smoothPath(trendCreated)} fill="none" stroke="#00b8ff" strokeWidth="3" strokeLinecap="round" />
              <path d={smoothPath(trendClosed)} fill="none" stroke="#21c77a" strokeWidth="3" strokeLinecap="round" />
              {trendDays.map((day, i) => i % trendStep === 0 ? <text key={day.date} x={trendCreated[i].x} y="188" textAnchor="middle" fontSize="9" fill="#7a8d85">{day.date.slice(5)}</text> : null)}
            </svg>
          </div>
          <div className="analytics-trend-total"><span>Создано <strong>{periodCreated}</strong></span><span>Закрыто <strong>{periodClosed}</strong></span><span>Баланс потока <strong className={periodCreated - periodClosed > 0 ? "negative" : "positive"}>{periodCreated - periodClosed > 0 ? "+" : ""}{periodCreated - periodClosed}</strong></span></div>
        </div>

        <div className="card analytics-chart-card">
          <div className="analytics-card-title-row"><div><h3>Состояние очереди</h3><p>Текущий backlog по статусам.</p></div><div className="analytics-donut" style={{ background: donut }}><div className="analytics-donut-inner">{totalTickets}</div></div></div>
          <div className="analytics-status-list">{statusCounts.map(({ status, count }) => <Link key={status} href={makeQuery({ ...params, status, page: "1" })} className="analytics-status-row"><span className="analytics-status-name"><span className="analytics-status-dot" style={{ background: statusColors[status] }} />{statusLabels[status]}</span><span className="analytics-status-bar"><span style={{ width: `${(count / totalCurrent) * 100}%`, background: statusColors[status] }} /></span><strong>{count}</strong></Link>)}</div>
          <div className="analytics-alert-strip"><span className="analytics-alert-dot" /> Критичные в очереди: <strong>{currentOpenCritical}</strong> ({currentCriticalPercent}%)</div>
        </div>
      </div>

      <div className="analytics-main-grid">
        <div className="card analytics-chart-card">
          <div className="analytics-card-title-row"><div><h3>Приоритеты</h3><p>Все текущие заявки, от критичных к низким.</p></div></div>
          <div className="analytics-priority-list">{priorityCounts.map(({ priority, count }) => <div className="analytics-priority-row" key={priority}><div className="analytics-priority-name"><span className="analytics-priority-dot" style={{ background: priorityColors[priority] }} />{priorityLabels[priority]}</div><div className="analytics-priority-bar"><span style={{ width: `${percent(count, totalCurrent)}%`, background: priorityColors[priority] }} /></div><strong>{count}</strong></div>)}</div>
          <div className="analytics-category-list"><div className="analytics-mini-heading">Создано по категориям за период</div>{categoryGroups.sort((a,b)=>b._count._all-a._count._all).slice(0,7).map((c)=><div className="analytics-category-row" key={c.category}><span>{c.category}</span><strong>{c._count._all}</strong></div>)}</div>
        </div>

        <div className="card analytics-chart-card">
          <div className="analytics-card-title-row"><div><h3>Контроль операционной нагрузки</h3><p>Показатели, на которые руководителю IT стоит смотреть ежедневно.</p></div></div>
          <div className="analytics-control-grid">
            <div><span>Активных IT</span><strong>{agentCount}</strong><em>активных IT-сотрудников</em></div>
            <div className={unassignedOpen > 0 ? "danger" : "ok"}><span>Без исполнителя</span><strong>{unassignedOpen}</strong><em>{unassignedOpen ? "нужно распределить" : "очередь распределена"}</em></div>
            <div className={currentOpenCritical > 0 ? "danger" : "ok"}><span>Критичные</span><strong>{currentOpenCritical}</strong><em>{currentOpenCritical ? "нужен контроль" : "нет критичной очереди"}</em></div>
            <div><span>SLA</span><strong>—</strong><em>нормативы SLA пока не настроены</em></div>
          </div>
        </div>
      </div>

      {activeView === "employees" && (
        <div className="card analytics-agent-performance">
        <div className="analytics-table-head"><div><h3>Работа IT-сотрудников</h3><p>Нагрузка, скорость и результат за {period.label.toLowerCase()}. Нажмите сотрудника для drill-down по заявкам.</p></div><div className="analytics-page-size">{agentMetrics.length} активных IT</div></div>
        <div className="analytics-table-wrap">
          <table className="table analytics-table analytics-performance-table">
            <thead><tr><th>Сотрудник</th><th>В работе</th><th>Закрыто</th><th>Создано</th><th>Обработано</th><th>Первый ответ</th><th>Среднее решение</th><th>Оценка</th></tr></thead>
            <tbody>{agentMetrics.map((agent) => <tr key={agent.id} className={selectedAgent === agent.id ? "analytics-row-selected" : ""}>
              <td><Link href={makeQuery({ ...params, view: "tickets", agent: selectedAgent === agent.id ? "" : agent.id, status: "ALL", page: "1" })} className="analytics-agent-link"><span className="analytics-avatar">{agent.name.trim().slice(0,1).toUpperCase()}</span><span><strong>{agent.name}</strong><small>{agent.department || "IT"}</small></span></Link></td>
              <td><strong>{agent.openNow + agent.inProgressNow + agent.waitingNow + agent.resolvedNow}</strong><small>{agent.openNow} новых · {agent.inProgressNow} в работе · {agent.waitingNow} ждут ответа · {agent.resolvedNow} решено</small></td>
              <td><strong>{agent.closedInPeriod}</strong></td><td>{agent.createdInPeriod}</td><td><strong>{agent.totalHandled}</strong></td>
              <td>{formatDuration(agent.avgFirstResponseMinutes)}</td><td>{formatDuration(agent.avgResolutionMinutes)}</td>
              <td>{agent.ratingAvg == null ? "—" : <><strong>{Number(agent.ratingAvg).toFixed(2)}</strong><small>{agent.ratedCount} оценок</small></>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>

      )}

      {activeView === "ratings" && (
        <div className="analytics-ratings-layout">
          <div className="analytics-rating-cards">
            <div className="analytics-rating-main"><span>Средняя оценка</span><strong>{ratingAverage == null ? "—" : ratingAverage.toFixed(2)}</strong><small>{ratingTotal} оценок за период</small></div>
            {ratingDistribution.map((row) => <Link key={row.score} href={makeQuery({ ...params, view: "ratings", rating: String(row.score), page: "1" })} className={`analytics-rating-card ${selectedRating === String(row.score) ? "active" : ""}`}><span>{row.score} ★</span><strong>{row.count}</strong><small>{percent(row.count, ratingTotal)}%</small></Link>)}
          </div>
          <div className="card analytics-table-card">
            <div className="analytics-table-head"><div><h3>Оценки по заявкам</h3><p>Нажмите оценку выше, чтобы оставить только заявки с выбранным баллом.</p></div><Link className="btn btn-secondary" href={makeQuery({ ...params, view: "ratings", rating: "ALL", page: "1" })}>Сбросить оценку</Link></div>
            {ratingTickets.length === 0 ? <p className="muted">За выбранный период оценок нет.</p> : <div className="analytics-table-wrap"><table className="table analytics-table"><thead><tr><th>Оценка</th><th>Заявка</th><th>Сотрудник</th><th>Статус</th><th>Комментарий</th><th>Дата</th></tr></thead><tbody>{ratingTickets.filter(t => selectedRating === "ALL" || String(t.rating?.score) === selectedRating).map(t => <tr key={t.id}><td><span className={`analytics-score-badge score-${t.rating?.score}`}>{t.rating?.score} ★</span></td><td><Link href={`/tickets/${t.id}`} className="analytics-ticket-title">#{t.number} · {t.title}</Link></td><td>{t.assignee?.name || "Не назначена"}</td><td><StatusBadge status={t.status}/></td><td>{t.rating?.comment || <span className="muted">Без комментария</span>}</td><td>{formatDate(t.rating?.createdAt || t.createdAt)}</td></tr>)}</tbody></table></div>}
          </div>
        </div>
      )}

      <div className="card analytics-filter-card">
        <div className="analytics-filter-head"><div><h3>Drill-down по заявкам</h3><p>Фильтрация по сотруднику и статусу. Таблица показывает заявки, созданные в выбранном периоде; до 100 за запрос.</p></div><div className="analytics-filter-count">Показано <strong>{from}–{to}</strong> из <strong>{filteredCount}</strong></div></div>
        <div className="analytics-filter-buttons"><span className="analytics-filter-label">Статус:</span><Link className={`analytics-filter-chip ${selectedStatus === "ALL" ? "active" : ""}`} href={makeQuery({ ...params, status: "ALL", page: "1" })}>Все</Link>{statusOrder.map((status)=><Link key={status} className={`analytics-filter-chip ${selectedStatus === status ? "active" : ""}`} href={makeQuery({ ...params, status, page: "1" })}>{statusLabels[status]}</Link>)}</div>
        <div className="analytics-filter-buttons"><span className="analytics-filter-label">Сотрудник:</span><Link className={`analytics-filter-chip ${!selectedAgent ? "active" : ""}`} href={makeQuery({ ...params, agent: "", page: "1" })}>Все</Link>{agentMetrics.map((agent)=><Link key={agent.id} className={`analytics-filter-chip ${selectedAgent === agent.id ? "active" : ""}`} href={makeQuery({ ...params, agent: agent.id, page: "1" })}>{agent.name}</Link>)}</div>
      </div>

      {activeView === "tickets" && (
      <div className="card analytics-table-card">
        <div className="analytics-table-head"><div><h3>Заявки</h3><p>{selectedAgent ? `Сотрудник: ${agentMetrics.find((a) => a.id === selectedAgent)?.name || "—"}` : "Все сотрудники"}{selectedStatus !== "ALL" ? ` · ${statusLabels[selectedStatus]}` : " · Все статусы"}</p></div><div className="analytics-page-size">До {PAGE_SIZE} за запрос</div></div>
        {filteredTickets.length === 0 ? <p className="muted">По выбранным фильтрам заявок нет.</p> : <div className="analytics-table-wrap"><table className="table analytics-table"><thead><tr><th>№</th><th>Заявка</th><th>Сотрудник</th><th>Статус</th><th>Приоритет</th><th>Автор</th><th>Последняя активность</th></tr></thead><tbody>{filteredTickets.map((ticket)=><tr key={ticket.id}><td><Link href={`/tickets/${ticket.id}`} className="analytics-number">#{ticket.number}</Link></td><td><Link href={`/tickets/${ticket.id}`} className="analytics-ticket-title">{ticket.title}</Link><div className="muted analytics-subline">{ticket.category}</div></td><td>{ticket.assignee?.name || "Не назначена"}</td><td><StatusBadge status={ticket.status}/></td><td><PriorityBadge priority={ticket.priority}/></td><td>{ticket.author?.name || "Гость"}</td><td>{formatDate(ticket.lastActivityAt)}</td></tr>)}</tbody></table></div>}
        {filteredTotalPages > 1 && <div className="analytics-pagination"><Link className={`btn btn-secondary ${currentPage === 1 ? "disabled" : ""}`} href={currentPage > 1 ? makeQuery({ ...params, page: String(currentPage - 1) }) : "#"}>← Назад</Link><span>Страница <strong>{currentPage}</strong> из <strong>{filteredTotalPages}</strong></span><Link className={`btn btn-secondary ${currentPage === filteredTotalPages ? "disabled" : ""}`} href={currentPage < filteredTotalPages ? makeQuery({ ...params, page: String(currentPage + 1) }) : "#"}>Вперёд →</Link></div>}
      </div>      )}

    </section>
  );
}
