import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isStore } from "@/lib/stores";

const createSchema = z.object({
  chatId: z.string().min(1).max(40),
  telegramUserId: z.string().min(1).max(40),
  telegramUsername: z.string().trim().max(80).optional().nullable(),
  displayName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(5).max(40),
  store: z.string().min(1).refine(isStore, "Выберите магазин"),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(5).max(5000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
});

function authorized(req: NextRequest) {
  const expected = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const actual = (req.headers.get("x-telegram-bot-token") || "").trim();
  if (!expected || !actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizePhone(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте данные заявки" }, { status: 400 });

  const data = parsed.data;
  const phoneDigits = normalizePhone(data.phone);
  const candidates = await prisma.user.findMany({
    where: { isActive: true, isBlocked: false, phone: { not: null } },
    select: { id: true, phone: true },
    take: 5000,
  });
  const matchedUser = phoneDigits
    ? candidates.find((item) => normalizePhone(item.phone) === phoneDigits)
    : undefined;

  const ticket = await prisma.ticket.create({
    data: {
      title: data.title,
      description: data.description,
      priority: data.priority,
      category: "Общее",
      store: data.store,
      source: "TELEGRAM",
      telegramChatId: data.chatId,
      telegramUserId: data.telegramUserId,
      telegramUsername: data.telegramUsername || null,
      authorId: matchedUser?.id || null,
      guestName: matchedUser ? null : data.displayName,
      guestPhone: matchedUser ? null : data.phone,
    },
    select: { id: true, number: true, title: true, status: true, priority: true, store: true, createdAt: true },
  });

  return NextResponse.json(ticket, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const chatId = (req.nextUrl.searchParams.get("chatId") || "").trim();
  if (!chatId || chatId.length > 40) return NextResponse.json({ error: "Некорректный chatId" }, { status: 400 });

  const tickets = await prisma.ticket.findMany({
    where: { source: "TELEGRAM", telegramChatId: chatId },
    orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    take: 10,
    select: { id: true, number: true, title: true, status: true, priority: true, store: true, createdAt: true, lastActivityAt: true },
  });

  return NextResponse.json({ tickets }, { headers: { "Cache-Control": "no-store" } });
}
