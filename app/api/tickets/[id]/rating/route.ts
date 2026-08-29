import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, jsonError } from "@/lib/auth";
import { cacheDelete } from "@/lib/cache";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  const { id } = await ctx.params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { rating: true },
  });
  if (!ticket) return jsonError("Заявка не найдена", 404);

  if (!ticket.authorId || ticket.authorId !== user.id) {
    return jsonError("Оценивать может только автор заявки", 403);
  }

  if (ticket.status !== "CLOSED") {
    return jsonError("Оценка доступна после закрытия заявки");
  }
  if (ticket.rating) return jsonError("Заявка уже оценена", 409);
  if (!ticket.assigneeId) return jsonError("У заявки нет исполнителя");

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return jsonError("Укажите оценку от 1 до 5");

  let rating;
  try {
    rating = await prisma.$transaction(async (tx) => {
      return tx.rating.create({
        data: {
          ticketId: ticket.id,
          authorId: user.id,
          agentId: ticket.assigneeId!,
          score: parsed.data.score,
          comment: parsed.data.comment?.trim() || null,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("Заявка уже оценена", 409);
    }
    throw error;
  }

  cacheDelete("analytics:closed");
  return NextResponse.json(rating, { status: 201 });
}
