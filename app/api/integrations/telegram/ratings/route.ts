import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cacheDelete } from "@/lib/cache";

const schema = z.object({
  chatId: z.string().min(1).max(40),
  ticketId: z.string().min(1).max(80),
  score: z.number().int().min(1).max(5),
});

function authorized(req: NextRequest) {
  const expected = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const actual = (req.headers.get("x-telegram-bot-token") || "").trim();
  if (!expected || !actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректная оценка" }, { status: 400 });

  const { chatId, ticketId, score } = parsed.data;
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, source: "TELEGRAM", telegramChatId: chatId },
    include: { rating: true },
  });

  if (!ticket) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  if (ticket.status !== "CLOSED") return NextResponse.json({ error: "Оценка доступна после закрытия заявки" }, { status: 409 });
  if (!ticket.assigneeId) return NextResponse.json({ error: "У заявки нет исполнителя" }, { status: 409 });

  if (ticket.rating) {
    return NextResponse.json({ ok: true, duplicate: true, score: ticket.rating.score, number: ticket.number });
  }

  try {
    const rating = await prisma.rating.create({
      data: {
        ticketId: ticket.id,
        authorId: ticket.authorId || null,
        agentId: ticket.assigneeId,
        score,
        comment: null,
      },
      select: { id: true, score: true, createdAt: true },
    });
    cacheDelete("analytics:closed");
    return NextResponse.json({ ok: true, duplicate: false, number: ticket.number, rating }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.rating.findUnique({ where: { ticketId: ticket.id }, select: { score: true } });
      return NextResponse.json({ ok: true, duplicate: true, score: existing?.score || score, number: ticket.number });
    }
    throw error;
  }
}
