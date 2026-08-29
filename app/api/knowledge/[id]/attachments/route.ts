import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, jsonError } from "@/lib/auth";
import { deleteStoredFile, hasExpectedFileSignature, isKnowledgeFile, MAX_FILE_SIZE, saveUploadedFile } from "@/lib/storage";
import { rejectOversizedRequest } from "@/lib/request-security";

 type Ctx = { params: Promise<{ id: string }> };
const MAX_FILES_PER_UPLOAD = 10;
const MAX_TOTAL_SIZE = 60 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: Ctx) {
  const oversized = rejectOversizedRequest(req, 65 * 1024 * 1024);
  if (oversized) return oversized;
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return jsonError("Только администратор может прикреплять файлы", 403);
  const { id } = await ctx.params;

  const article = await prisma.knowledgeArticle.findUnique({ where: { id }, select: { id: true, visibility: true } });
  if (!article || article.visibility !== "ALL") return jsonError("Материал не найден", 404);

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") || []).filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length) return jsonError("Выберите хотя бы один файл");
  if (files.length > MAX_FILES_PER_UPLOAD) return jsonError(`Можно прикрепить не более ${MAX_FILES_PER_UPLOAD} файлов за раз`);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) return jsonError("Общий размер файлов за одну загрузку не должен превышать 60 МБ");

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) return jsonError(`Файл «${file.name}» больше 15 МБ`);
    if (!isKnowledgeFile(file) || !(await hasExpectedFileSignature(file))) return jsonError(`Файл «${file.name}» не соответствует разрешённому формату`);
  }

  const saved = [] as Awaited<ReturnType<typeof saveUploadedFile>>[];
  try {
    for (const file of files) saved.push(await saveUploadedFile(file));

    const attachments = await prisma.$transaction(async (tx) => {
      const result = [];
      for (const file of saved) {
        result.push(await tx.knowledgeAttachment.create({
          data: { ...file, articleId: id },
          select: { id: true, filename: true, mimeType: true, size: true, createdAt: true },
        }));
      }
      return result;
    });

    return NextResponse.json(attachments, { status: 201 });
  } catch (error) {
    await Promise.all(saved.map((file) => deleteStoredFile(file.storedName)));
    throw error;
  }
}
