import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUser, jsonError } from "@/lib/auth";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge";

const categorySchema = z.enum(KNOWLEDGE_CATEGORIES);

function searchWhere(q: string) {
  return q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { summary: { contains: q, mode: "insensitive" as const } },
          { body: { contains: q, mode: "insensitive" as const } },
          { tags: { has: q } },
        ],
      }
    : {};
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);

  const q = (req.nextUrl.searchParams.get("q") || "").trim().slice(0, 160);
  const rawCategory = req.nextUrl.searchParams.get("category") || "";
  const category = rawCategory && rawCategory !== "Все" ? categorySchema.safeParse(rawCategory) : null;
  if (category && !category.success) return jsonError("Неизвестная категория");

  const baseWhere = {
    visibility: "ALL" as const,
    ...searchWhere(q),
  };

  const [articles, grouped, total] = await Promise.all([
    prisma.knowledgeArticle.findMany({
      where: {
        ...baseWhere,
        ...(category?.success ? { category: category.data } : {}),
      },
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: 200,
      include: {
        author: { select: { id: true, name: true } },
        attachments: {
          select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.knowledgeArticle.groupBy({
      by: ["category"],
      where: baseWhere,
      _count: { _all: true },
    }),
    prisma.knowledgeArticle.count({ where: baseWhere }),
  ]);

  const counts = Object.fromEntries(KNOWLEDGE_CATEGORIES.map((item) => [item, 0])) as Record<string, number>;
  for (const row of grouped) {
    if (row.category in counts) counts[row.category] = row._count._all;
  }

  return NextResponse.json({ items: articles, counts, total });
}

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(400).optional(),
  body: z.string().trim().min(5).max(30000),
  category: categorySchema.default("Общее"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  isPinned: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return jsonError("Только администратор может добавлять материалы", 403);

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Проверьте поля материала");

  const article = await prisma.knowledgeArticle.create({
    data: {
      ...parsed.data,
      summary: parsed.data.summary || null,
      visibility: "ALL",
      authorId: user.id,
    },
    include: {
      author: { select: { id: true, name: true } },
      attachments: true,
    },
  });

  return NextResponse.json(article, { status: 201 });
}
