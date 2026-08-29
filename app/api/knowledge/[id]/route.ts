import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, jsonError } from "@/lib/auth";
import { deleteStoredFile } from "@/lib/storage";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge";

const categorySchema = z.enum(KNOWLEDGE_CATEGORIES);
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);

  const { id } = await ctx.params;
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      attachments: {
        select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!article || article.visibility !== "ALL") return jsonError("Материал не найден", 404);

  await prisma.knowledgeArticle.update({ where: { id }, data: { views: { increment: 1 } } });
  return NextResponse.json(article);
}

const patchSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  summary: z.string().trim().max(400).nullable().optional(),
  body: z.string().trim().min(5).max(30000).optional(),
  category: categorySchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  isPinned: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return jsonError("Только администратор может изменять материалы", 403);
  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Некорректные данные");

  const existing = await prisma.knowledgeArticle.findUnique({ where: { id }, select: { id: true, visibility: true } });
  if (!existing || existing.visibility !== "ALL") return jsonError("Материал не найден", 404);

  const article = await prisma.knowledgeArticle.update({
    where: { id },
    data: parsed.data,
    include: {
      author: { select: { id: true, name: true } },
      attachments: true,
    },
  });
  return NextResponse.json(article);
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return jsonError("Только администратор может удалять материалы", 403);
  const { id } = await ctx.params;

  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
    select: { visibility: true, attachments: { select: { storedName: true } } },
  });
  if (!article || article.visibility !== "ALL") return jsonError("Материал не найден", 404);

  await prisma.knowledgeArticle.delete({ where: { id } });
  await Promise.all(article.attachments.map((attachment) => deleteStoredFile(attachment.storedName)));
  return NextResponse.json({ ok: true });
}
