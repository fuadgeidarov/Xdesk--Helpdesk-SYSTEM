import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, jsonError } from "@/lib/auth";
import { deleteStoredFile } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return jsonError("Доступ запрещен", 403);
  const { id, attachmentId } = await ctx.params;

  const attachment = await prisma.knowledgeAttachment.findFirst({ where: { id: attachmentId, articleId: id } });
  if (!attachment) return jsonError("Вложение не найдено", 404);
  await prisma.knowledgeAttachment.delete({ where: { id: attachment.id } });
  await deleteStoredFile(attachment.storedName);
  return NextResponse.json({ ok: true });
}
