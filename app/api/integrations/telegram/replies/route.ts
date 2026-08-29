import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withTransactionRetry } from "@/lib/db-retry";
import { enqueueCommentSideEffects } from "@/lib/message-queue";
import { MAX_FILE_SIZE, deleteStoredFile, hasExpectedFileSignature, isAllowedUploadFile, saveUploadedFile } from "@/lib/storage";
import { rejectOversizedRequest } from "@/lib/request-security";

const bodySchema = z.string().max(4000);
const MAX_FILES = 5;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

function authorized(req: NextRequest) {
  const expected = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const actual = (req.headers.get("x-telegram-bot-token") || "").trim();
  if (!expected || !actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function resolveTicket(chatId: string, ticketId?: string | null) {
  if (ticketId) {
    return prisma.ticket.findFirst({
      where: { id: ticketId, source: "TELEGRAM", telegramChatId: chatId },
      select: { id: true, number: true, title: true, status: true, authorId: true },
    });
  }
  const active = await prisma.ticket.findMany({
    where: { source: "TELEGRAM", telegramChatId: chatId, status: { not: "CLOSED" } },
    orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    take: 2,
    select: { id: true, number: true, title: true, status: true, authorId: true },
  });
  return active.length === 1 ? active[0] : null;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const oversized = rejectOversizedRequest(req, 55 * 1024 * 1024);
  if (oversized) return oversized;

  const contentType = req.headers.get("content-type") || "";
  let chatId = "";
  let ticketId: string | null = null;
  let displayName = "Пользователь Telegram";
  let externalMessageId = "";
  let body = "";
  let files: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    chatId = String(fd.get("chatId") || "").trim();
    ticketId = String(fd.get("ticketId") || "").trim() || null;
    displayName = String(fd.get("displayName") || "Пользователь Telegram").trim().slice(0, 100);
    externalMessageId = String(fd.get("externalMessageId") || "").trim().slice(0, 120);
    body = String(fd.get("body") || "").trim();
    files = [...fd.getAll("files"), ...fd.getAll("file")].filter((v): v is File => v instanceof File && v.size > 0);
  } else {
    const raw = await req.json().catch(() => null) as Record<string, unknown> | null;
    chatId = String(raw?.chatId || "").trim();
    ticketId = String(raw?.ticketId || "").trim() || null;
    displayName = String(raw?.displayName || "Пользователь Telegram").trim().slice(0, 100);
    externalMessageId = String(raw?.externalMessageId || "").trim().slice(0, 120);
    body = String(raw?.body || "").trim();
  }

  if (!chatId || chatId.length > 40) return NextResponse.json({ error: "Некорректный chatId" }, { status: 400 });
  if (!externalMessageId) return NextResponse.json({ error: "Нет ID сообщения Telegram" }, { status: 400 });
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) return NextResponse.json({ error: "Сообщение слишком длинное" }, { status: 400 });
  if (!parsedBody.data && files.length === 0) return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `Не более ${MAX_FILES} файлов` }, { status: 400 });
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_SIZE) return NextResponse.json({ error: "Файлы слишком большие" }, { status: 400 });
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: `Файл «${file.name}» больше 15 МБ` }, { status: 400 });
    if (!isAllowedUploadFile(file) || !(await hasExpectedFileSignature(file))) {
      return NextResponse.json({ error: `Формат файла «${file.name}» не поддерживается` }, { status: 400 });
    }
  }

  const duplicate = await prisma.comment.findUnique({ where: { externalMessageId }, select: { id: true, ticketId: true } });
  if (duplicate) return NextResponse.json({ ok: true, duplicate: true, commentId: duplicate.id, ticketId: duplicate.ticketId });

  const ticket = await resolveTicket(chatId, ticketId);
  if (!ticket) return NextResponse.json({ error: "SELECT_TICKET" }, { status: 409 });
  if (ticket.status === "CLOSED") return NextResponse.json({ error: "TICKET_CLOSED", number: ticket.number }, { status: 409 });

  const saved: Awaited<ReturnType<typeof saveUploadedFile>>[] = [];
  try {
    for (const file of files) saved.push(await saveUploadedFile(file));
    const createdAt = new Date();
    const comment = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          body: parsedBody.data,
          ticketId: ticket.id,
          authorId: ticket.authorId || null,
          source: "TELEGRAM",
          externalAuthorName: displayName || "Пользователь Telegram",
          externalMessageId,
          createdAt,
          attachments: saved.length ? { create: saved } : undefined,
        },
        include: { author: { select: { id: true, name: true, role: true } }, attachments: true },
      });
      await tx.$executeRaw`
        UPDATE "Ticket"
        SET "lastActivityAt" = GREATEST("lastActivityAt", ${createdAt}), "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${ticket.id}
      `;
      return created;
    }));
    enqueueCommentSideEffects({ ticketId: ticket.id, commentId: comment.id });
    return NextResponse.json({ ok: true, ticket: { id: ticket.id, number: ticket.number, title: ticket.title }, comment });
  } catch (error) {
    await Promise.allSettled(saved.map((f) => deleteStoredFile(f.storedName)));
    throw error;
  }
}
