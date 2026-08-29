import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma, Priority, TicketStatus } from "@prisma/client";
import { getSessionUser, isStaff } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PriorityBadge, StatusBadge } from "@/components/Badges";
import { TicketDeleteButton, TicketTakeButton } from "@/components/TicketAdminActions";
import { ticketStatusOrder } from "@/lib/workflow";

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;
const priorities: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const sortKeys = ["created_desc", "created_asc", "activity_desc", "priority_desc"] as const;
type SortKey = (typeof sortKeys)[number];
type SearchParams = { page?: string; pageSize?: string; q?: string; status?: string; priority?: string; assignee?: string; sort?: string };

function validStatus(value?: string): TicketStatus | undefined {
  return ticketStatusOrder.includes(value as TicketStatus) ? (value as TicketStatus) : undefined;
}
function validPriority(value?: string): Priority | undefined {
  return priorities.includes(value as Priority) ? (value as Priority) : undefined;
}
function validSort(value?: string): SortKey {
  return sortKeys.includes(value as SortKey) ? (value as SortKey) : "activity_desc";
}
function orderBy(sort: SortKey): Prisma.TicketOrderByWithRelationInput[] {
  if (sort === "created_asc") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "created_desc") return [{ createdAt: "desc" }, { id: "desc" }];
  if (sort === "priority_desc") return [{ priority: "desc" }, { lastActivityAt: "desc" }, { id: "desc" }];
  return [{ lastActivityAt: "desc" }, { id: "desc" }];
}

export default async function TicketsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const staff = isStaff(user.role);
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 160) || "";
  const status = validStatus(params.status);
  const priority = validPriority(params.priority);
  const sort = validSort(params.sort);
  const assignee = staff ? (params.assignee || "") : "";
  const rawPage = Number(params.page || "1");
  const requestedPage = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const rawPageSize = Number(params.pageSize || DEFAULT_PAGE_SIZE);
  const pageSize = PAGE_SIZES.includes(rawPageSize as (typeof PAGE_SIZES)[number]) ? rawPageSize : DEFAULT_PAGE_SIZE;

  const baseWhere: Prisma.TicketWhereInput = staff ? {} : { authorId: user.id };
  if (priority) baseWhere.priority = priority;
  if (staff && assignee === "UNASSIGNED") baseWhere.assigneeId = null;
  else if (staff && assignee) baseWhere.assigneeId = assignee;
  if (q) {
    const numeric = Number(q.replace(/^X?-?/i, "").replace(/^#/, ""));
    baseWhere.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { store: { contains: q, mode: "insensitive" } },
      ...(Number.isInteger(numeric) && numeric > 0 ? [{ number: numeric }] : []),
    ];
  }
  const where: Prisma.TicketWhereInput = { ...baseWhere, ...(status ? { status } : {}) };

  const [total, statusGroups, assignees] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
    staff
      ? prisma.user.findMany({
          where: { role: { in: ["AGENT", "ADMIN"] }, isActive: true, isBlocked: false },
          select: { id: true, name: true, role: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pages);
  const tickets = await prisma.ticket.findMany({
    where,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: orderBy(sort),
    include: {
      author: { select: { name: true } },
      assignee: { select: { id: true, name: true } },
      rating: { select: { score: true } },
    },
  });

  const statusCount = new Map(statusGroups.map((row) => [row.status, row._count._all]));
  const allCount = statusGroups.reduce((sum, row) => sum + row._count._all, 0);
  const urlFor = (changes: Partial<SearchParams> = {}) => {
    const next = { ...params, ...changes };
    const sp = new URLSearchParams();
    if (next.q) sp.set("q", next.q);
    if (next.status) sp.set("status", next.status);
    if (next.priority) sp.set("priority", next.priority);
    if (staff && next.assignee) sp.set("assignee", next.assignee);
    if (next.sort && next.sort !== "activity_desc") sp.set("sort", next.sort);
    if (next.pageSize && Number(next.pageSize) !== DEFAULT_PAGE_SIZE) sp.set("pageSize", next.pageSize);
    if (next.page && Number(next.page) > 1) sp.set("page", next.page);
    return sp.size ? `/tickets?${sp.toString()}` : "/tickets";
  };

  return (
    <section className="section tickets-page">
      <div className="section-head tickets-head">
        <div>
          <h2>{staff ? "Очередь заявок" : "Мои заявки"}</h2>
          <p>{staff ? `${allCount} заявок · рабочая очередь IT-поддержки` : "Только обращения, созданные вашей учётной записью"}</p>
        </div>
        <Link href="/tickets/new" className="btn btn-primary">+ Создать заявку</Link>
      </div>

      <div className="card tickets-toolbar-card">
        <div className="tickets-toolbar-top">
          <div className="tickets-status-tabs" aria-label="Фильтр по статусу">
            <Link className={`tickets-status-tab ${!status ? "active" : ""}`} href={urlFor({ status: undefined, page: "1" })}>Все <span>{allCount}</span></Link>
            {ticketStatusOrder.map((value) => (
              <Link key={value} className={`tickets-status-tab ${status === value ? "active" : ""}`} href={urlFor({ status: value, page: "1" })}>
                <StatusBadge status={value} /> <span>{statusCount.get(value) || 0}</span>
              </Link>
            ))}
          </div>
          <span className="tickets-found">Найдено: {total}</span>
        </div>

        <form className="tickets-filter-form" method="get">
          <label className="tickets-search"><span className="sr-only">Поиск</span><input name="q" defaultValue={q} placeholder="ID или тема..." /></label>
          <select name="priority" defaultValue={priority || ""} aria-label="Приоритет">
            <option value="">Все приоритеты</option><option value="CRITICAL">Критичный</option><option value="HIGH">Высокий</option><option value="MEDIUM">Средний</option><option value="LOW">Низкий</option>
          </select>
          {staff && (
            <select name="assignee" defaultValue={assignee} aria-label="Исполнитель">
              <option value="">Все исполнители</option>
              <option value="UNASSIGNED">Без исполнителя</option>
              {assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          <select name="sort" defaultValue={sort} aria-label="Сортировка">
            <option value="activity_desc">По последней активности</option><option value="created_desc">Сначала новые</option><option value="created_asc">Сначала старые</option><option value="priority_desc">По приоритету</option>
          </select>
          {status && <input type="hidden" name="status" value={status} />}
          <input type="hidden" name="pageSize" value={pageSize} />
          <button className="btn btn-secondary" type="submit">Применить</button>
          {(q || priority || status || assignee || sort !== "activity_desc") && <Link href="/tickets" className="btn btn-secondary">Сбросить</Link>}
        </form>
      </div>

      <div className="tickets-list">
        {tickets.length === 0 ? (
          <div className="card tickets-empty"><strong>{staff ? "Заявок не найдено" : "У вас пока нет заявок по этим условиям"}</strong><span>Измените фильтры или создайте новое обращение.</span></div>
        ) : tickets.map((ticket) => (
          <article className="card ticket-list-card" key={ticket.id}>
            <div className="ticket-list-main">
              <div className="ticket-list-meta"><Link href={`/tickets/${ticket.id}`} className="ticket-number">X-{ticket.number}</Link><StatusBadge status={ticket.status} /><PriorityBadge priority={ticket.priority} /></div>
              <Link href={`/tickets/${ticket.id}`} className="ticket-list-title">{ticket.title}</Link>
              <div className="ticket-list-submeta" aria-label="Сведения о заявке">
                <span className="ticket-submeta-item">{ticket.category}</span>
                {ticket.store && <span className="ticket-submeta-item">{ticket.store}</span>}
                {staff && ticket.source === "TELEGRAM" && <span className="ticket-submeta-item">Telegram</span>}
                {staff && <span className="ticket-submeta-item">{ticket.author?.name || ticket.guestName || "Гость"}</span>}
              </div>
            </div>
            <div className="ticket-list-side">
              <div><span className="muted">Исполнитель</span><strong>{ticket.assignee?.name || "Без исполнителя"}</strong>{staff && !ticket.assignee && ticket.status !== "CLOSED" && <TicketTakeButton ticketId={ticket.id} userId={user.id} />}</div>
              <div><span className="muted">Активность</span><strong>{ticket.lastActivityAt.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</strong></div>
              {ticket.rating && <div><span className="muted">Оценка</span><strong>★ {ticket.rating.score}</strong></div>}
              {user.role === "ADMIN" && <TicketDeleteButton ticketId={ticket.id} compact />}
            </div>
          </article>
        ))}
      </div>

      <div className="tickets-pagination">
        <div className="tickets-page-size">
          <span>На странице:</span>
          {PAGE_SIZES.map((size) => <Link key={size} className={`page-size-link ${pageSize === size ? "active" : ""}`} href={urlFor({ pageSize: String(size), page: "1" })}>{size}</Link>)}
        </div>
        <div className="tickets-page-numbers" aria-label="Страницы">
          <Link className={`page-number ${page <= 1 ? "disabled" : ""}`} href={urlFor({ page: String(Math.max(1, page - 1)) })}>‹</Link>
          {Array.from({ length: pages }, (_, index) => index + 1).filter((n) => pages <= 9 || n === 1 || n === pages || Math.abs(n - page) <= 2).map((n, index, visible) => (
            <span key={n} className="page-number-wrap">{index > 0 && n - visible[index - 1] > 1 && <span className="page-ellipsis">…</span>}<Link className={`page-number ${n === page ? "active" : ""}`} href={urlFor({ page: String(n) })}>{n}</Link></span>
          ))}
          <Link className={`page-number ${page >= pages ? "disabled" : ""}`} href={urlFor({ page: String(Math.min(pages, page + 1)) })}>›</Link>
        </div>
        <span className="tickets-page-summary">{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} из ${total}` : "0 заявок"}</span>
      </div>
    </section>
  );
}
