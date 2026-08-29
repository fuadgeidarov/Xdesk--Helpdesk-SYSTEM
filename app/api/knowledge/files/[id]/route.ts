import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, jsonError } from "@/lib/auth";
import { readStoredFile } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);

  const { id } = await ctx.params;
  const attachment = await prisma.knowledgeAttachment.findUnique({
    where: { id },
    include: { article: { select: { visibility: true } } },
  });
  if (!attachment || attachment.article.visibility !== "ALL") return jsonError("Вложение не найдено", 404);

  try {
    const file = await readStoredFile(attachment.storedName);
    return new NextResponse(file, {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError("Файл не найден на сервере", 404);
  }
}
