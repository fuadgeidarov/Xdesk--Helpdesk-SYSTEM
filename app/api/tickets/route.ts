import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isStaff, jsonError } from "@/lib/auth";
import { isStore } from "@/lib/stores";
import { MAX_FILE_SIZE, deleteStoredFile, hasExpectedFileSignature, isAllowedUploadFile, saveUploadedFile } from "@/lib/storage";
import { ticketStatusOrder } from "@/lib/workflow";
import { checkRateLimit, requestClientKey } from "@/lib/rate-limit";
import { rejectOversizedRequest } from "@/lib/request-security";

const createSchema = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(5).max(5000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  category: z.string().min(2).max(80).default("Общее"),
  store: z.string().min(1).refine(isStore, "Выберите магазин"),
  guestName: z.string().min(2).max(80).optional(),
  guestPhone: z.string().trim().max(40).optional(),
});
const ticketPriorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const ticketSorts = ["created_desc", "created_asc", "activity_desc", "priority_desc"] as const;
const MAX_FILES = 5;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

function isTicketStatus(value: string): value is TicketStatus { return ticketStatusOrder.includes(value as TicketStatus); }
function isTicketPriority(value: string): value is (typeof ticketPriorities)[number] { return (ticketPriorities as readonly string[]).includes(value); }
function isTicketSort(value: string): value is (typeof ticketSorts)[number] { return (ticketSorts as readonly string[]).includes(value); }
function ticketOrderBy(sort: (typeof ticketSorts)[number]): Prisma.TicketOrderByWithRelationInput[] {
  if (sort === "created_asc") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "activity_desc") return [{ lastActivityAt: "desc" }, { id: "desc" }];
  if (sort === "priority_desc") return [{ priority: "desc" }, { lastActivityAt: "desc" }, { id: "desc" }];
  return [{ createdAt: "desc" }, { id: "desc" }];
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  const params = req.nextUrl.searchParams;
  const pageRaw = Number(params.get("page") || 1);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const limitRaw = Number(params.get("limit") || 30);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 30;
  const status = params.get("status");
  const priority = params.get("priority");
  const assigneeId = params.get("assigneeId");
  const q = params.get("q")?.trim();
  const sortValue = params.get("sort") || "activity_desc";
  const sort = isTicketSort(sortValue) ? sortValue : "activity_desc";

  const where: Prisma.TicketWhereInput = isStaff(user.role) ? {} : { authorId: user.id };
  if (status && isTicketStatus(status)) where.status = status;
  if (priority && isTicketPriority(priority)) where.priority = priority;
  if (isStaff(user.role) && assigneeId) where.assigneeId = assigneeId === "UNASSIGNED" ? null : assigneeId;
  if (q) {
    const numeric = Number(q.replace(/^X?-?/i, "").replace(/^#/, ""));
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { store: { contains: q, mode: "insensitive" } },
      ...(Number.isInteger(numeric) && numeric > 0 ? [{ number: numeric }] : []),
    ];
  }

  const include = {
    author: { select: { id: true, name: true, email: true } },
    assignee: { select: { id: true, name: true, email: true } },
    rating: { select: { id: true, score: true, comment: true, createdAt: true } },
  } as const;
  const [tickets, total, grouped] = await Promise.all([
    prisma.ticket.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: ticketOrderBy(sort), include }),
    prisma.ticket.count({ where }),
    prisma.ticket.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const statusCounts = Object.fromEntries(ticketStatusOrder.map((item) => [item, 0])) as Record<string, number>;
  for (const row of grouped) statusCounts[row.status] = row._count._all;
  return NextResponse.json({ tickets, pagination: { page, limit, total, sort, pages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 }, statusCounts }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const oversized = rejectOversizedRequest(req, 55 * 1024 * 1024);
  if (oversized) return oversized;
  const user = await getSessionUser();
  if (!user) {
    const limit = checkRateLimit(`guest-ticket:${requestClientKey(req.headers)}`, 500, 10 * 60_000);
    if (!limit.allowed) return NextResponse.json({ error: "Слишком много обращений. Повторите позже" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const contentType = req.headers.get("content-type") || "";
  let raw: Record<string, unknown>;
  let files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    raw = { title: fd.get("title"), description: fd.get("description"), priority: fd.get("priority") || undefined, category: fd.get("category") || undefined, store: fd.get("store") || undefined, guestName: fd.get("guestName") || undefined, guestPhone: fd.get("guestPhone") || undefined };
    files = [...fd.getAll("files"), ...fd.getAll("file")].filter((value): value is File => value instanceof File && value.size > 0);
  } else raw = (await req.json().catch(() => null)) || {};

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return jsonError("Проверьте данные заявки");
  if (!user && !parsed.data.guestName) return jsonError("Укажите ваше имя");
  if (files.length > MAX_FILES) return jsonError(`Можно прикрепить не более ${MAX_FILES} файлов`);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) return jsonError("Общий размер вложений не должен превышать 50 МБ");
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) return jsonError(`Файл «${file.name}» больше 15 МБ`);
    if (!isAllowedUploadFile(file) || !(await hasExpectedFileSignature(file))) return jsonError(`Файл «${file.name}» не соответствует разрешённому формату`);
  }

  const saved = [] as Awaited<ReturnType<typeof saveUploadedFile>>[];
  try {
    for (const file of files) saved.push(await saveUploadedFile(file));
    const ticket = await prisma.ticket.create({
      data: {
        title: parsed.data.title.trim(), description: parsed.data.description.trim(), priority: parsed.data.priority, category: parsed.data.category, store: parsed.data.store,
        authorId: user ? user.id : null, guestName: user ? null : parsed.data.guestName?.trim(), guestPhone: user ? null : (parsed.data.guestPhone?.trim() || null),
        attachments: saved.length ? { create: saved } : undefined,
      },
      include: { author: { select: { id: true, name: true } }, attachments: true },
    });
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    await Promise.allSettled(saved.map((file) => deleteStoredFile(file.storedName)));
    throw error;
  }
}
