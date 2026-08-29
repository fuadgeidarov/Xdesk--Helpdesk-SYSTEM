import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isStaff, jsonError } from "@/lib/auth";
import { readStoredFile } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      ticket: { select: { authorId: true } },
      comment: { select: { ticket: { select: { authorId: true } } } },
    },
  });
  if (!attachment) return jsonError("Файл не найден", 404);

  const ticketAuthorId = attachment.ticket?.authorId ?? attachment.comment?.ticket.authorId ?? null;
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);
  if (!isStaff(user.role) && (!ticketAuthorId || user.id !== ticketAuthorId)) {
    return jsonError("Нет доступа", 403);
  }

  try {
    const buffer = await readStoredFile(attachment.storedName);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Disposition": `${attachment.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError("Файл не найден на сервере", 404);
  }
}
