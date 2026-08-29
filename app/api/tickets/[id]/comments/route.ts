import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isStaff, jsonError } from "@/lib/auth";
import { enqueueCommentSideEffects } from "@/lib/message-queue";
import { withTransactionRetry } from "@/lib/db-retry";
import { MAX_FILE_SIZE, deleteStoredFile, hasExpectedFileSignature, isAllowedUploadFile, saveUploadedFile } from "@/lib/storage";
import { rejectOversizedRequest } from "@/lib/request-security";
import { notifyTelegramComment } from "@/lib/telegram";

type Ctx = { params: Promise<{ id: string }> };
const MAX_FILES = 5;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const bodySchema = z.string().max(4000);
const include = { author: { select: { id: true, name: true, role: true } }, attachments: true } as const;

async function accessibleTicket(id: string, userId: string, staff: boolean) {
  const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, authorId: true, status: true, lastActivityAt: true } });
  if (!ticket) return { error: jsonError("Заявка не найдена", 404) } as const;
  if (!staff && ticket.authorId !== userId) return { error: jsonError("Нет доступа", 403) } as const;
  return { ticket } as const;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  const { id } = await ctx.params;
  const staff = isStaff(user.role);
  const access = await accessibleTicket(id, user.id, staff);
  if ("error" in access) return access.error;
  const ticket = access.ticket;

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const afterId = req.nextUrl.searchParams.get("afterId");
  const beforeRaw = req.nextUrl.searchParams.get("before");
  const beforeId = req.nextUrl.searchParams.get("beforeId");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const before = beforeRaw ? new Date(beforeRaw) : null;
  const isIncremental = !!since && !Number.isNaN(since.getTime());
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") || 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 100;

  if (before && !Number.isNaN(before.getTime()) && !isIncremental) {
    const olderDesc = await prisma.comment.findMany({
      where: { ticketId: id, ...(staff ? {} : { isInternal: false }), ...(beforeId ? { OR: [{ createdAt: { lt: before } }, { createdAt: before, id: { lt: beforeId } }] } : { createdAt: { lt: before } }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, include,
    });
    return NextResponse.json({ comments: olderDesc.reverse(), status: ticket.status, lastActivityAt: ticket.lastActivityAt, hasMore: olderDesc.length === limit, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }

  if (isIncremental) {
    const comments = await prisma.comment.findMany({
      where: { ticketId: id, ...(staff ? {} : { isInternal: false }), ...(afterId ? { OR: [{ createdAt: { gt: since! } }, { createdAt: since!, id: { gt: afterId } }] } : { createdAt: { gt: since! } }) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit, include,
    });
    return NextResponse.json({ comments, status: ticket.status, lastActivityAt: ticket.lastActivityAt, hasMore: comments.length === limit, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }

  const commentsDesc = await prisma.comment.findMany({ where: { ticketId: id, ...(staff ? {} : { isInternal: false }) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, include });
  return NextResponse.json({ comments: commentsDesc.reverse(), status: ticket.status, lastActivityAt: ticket.lastActivityAt, hasMore: commentsDesc.length === limit, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const oversized = rejectOversizedRequest(req, 55 * 1024 * 1024);
  if (oversized) return oversized;
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  const { id } = await ctx.params;
  const staff = isStaff(user.role);
  const access = await accessibleTicket(id, user.id, staff);
  if ("error" in access) return access.error;

  const contentType = req.headers.get("content-type") || "";
  let body = "";
  let isInternal = false;
  let files: File[] = [];
  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    body = String(fd.get("body") || "");
    isInternal = staff && fd.get("isInternal") === "true";
    files = [...fd.getAll("files"), ...fd.getAll("file")].filter((value): value is File => value instanceof File && value.size > 0);
  } else {
    const raw = (await req.json().catch(() => null)) as { body?: unknown; isInternal?: unknown } | null;
    body = typeof raw?.body === "string" ? raw.body : "";
    isInternal = staff && raw?.isInternal === true;
  }
  const parsedBody = bodySchema.safeParse(body.trim());
  if (!parsedBody.success) return jsonError("Сообщение слишком длинное");
  if (!parsedBody.data && files.length === 0) return jsonError("Введите сообщение или прикрепите файл");
  if (files.length > MAX_FILES) return jsonError(`Можно прикрепить не более ${MAX_FILES} файлов`);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) return jsonError("Общий размер вложений не должен превышать 50 МБ");
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) return jsonError(`Файл «${file.name}» больше 15 МБ`);
    if (!isAllowedUploadFile(file) || !(await hasExpectedFileSignature(file))) return jsonError(`Файл «${file.name}» не соответствует разрешённому формату`);
  }

  const saved = [] as Awaited<ReturnType<typeof saveUploadedFile>>[];
  try {
    for (const file of files) saved.push(await saveUploadedFile(file));
    const createdAt = new Date();
    const comment = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: { body: parsedBody.data, isInternal, ticketId: id, authorId: user.id, createdAt, attachments: saved.length ? { create: saved } : undefined },
        include,
      });
      await tx.$executeRaw`
        UPDATE "Ticket"
        SET "lastActivityAt" = GREATEST("lastActivityAt", ${createdAt}),
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}
      `;
      return created;
    }));
    enqueueCommentSideEffects({ ticketId: id, commentId: comment.id });
    if (staff && !comment.isInternal) {
      const telegramTicket = await prisma.ticket.findUnique({
        where: { id },
        select: { id: true, number: true, source: true, telegramChatId: true },
      });
      if (telegramTicket?.source === "TELEGRAM" && telegramTicket.telegramChatId) {
        notifyTelegramComment(telegramTicket, {
          body: comment.body,
          isInternal: comment.isInternal,
          author: comment.author,
          attachments: comment.attachments,
        }).catch((error) => console.error("[Telegram] Failed to deliver Xdesk reply:", error));
      }
    }
    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    await Promise.allSettled(saved.map((file) => deleteStoredFile(file.storedName)));
    throw error;
  }
}
