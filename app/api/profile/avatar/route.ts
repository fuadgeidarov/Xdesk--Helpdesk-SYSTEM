import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, jsonError } from "@/lib/auth";
import { deleteStoredFile, hasExpectedFileSignature, isProfileImage, MAX_AVATAR_SIZE, readStoredFile, saveUploadedFile } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { rejectOversizedRequest } from "@/lib/request-security";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);

  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarStoredName: true, avatarMimeType: true },
  });
  if (!profile?.avatarStoredName) return jsonError("Фото профиля не найдено", 404);

  try {
    const file = await readStoredFile(profile.avatarStoredName);
    return new NextResponse(file, {
      headers: {
        "Content-Type": profile.avatarMimeType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError("Фото профиля не найдено", 404);
  }
}

export async function POST(req: NextRequest) {
  const oversized = rejectOversizedRequest(req, 6 * 1024 * 1024);
  if (oversized) return oversized;
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);

  const form = await req.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!(file instanceof File) || file.size === 0) return jsonError("Выберите фото профиля");
  if (file.size > MAX_AVATAR_SIZE) return jsonError("Фото должно быть не больше 5 МБ");
  if (!isProfileImage(file) || !(await hasExpectedFileSignature(file))) return jsonError("Файл не является корректным PNG, JPG, GIF или WebP");

  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarStoredName: true },
  });
  const saved = await saveUploadedFile(file);

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        avatarStoredName: saved.storedName,
        avatarMimeType: saved.mimeType,
        avatarUpdatedAt: new Date(),
      },
      select: { avatarUpdatedAt: true },
    });
    if (existing?.avatarStoredName) await deleteStoredFile(existing.avatarStoredName);
    return NextResponse.json(updated, { status: 201 });
  } catch (error) {
    await deleteStoredFile(saved.storedName);
    throw error;
  }
}


export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return jsonError("Не авторизован", 401);

  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { avatarStoredName: true },
  });
  if (!existing?.avatarStoredName) return NextResponse.json({ ok: true });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      avatarStoredName: null,
      avatarMimeType: null,
      avatarUpdatedAt: null,
    },
  });

  await deleteStoredFile(existing.avatarStoredName);
  return NextResponse.json({ ok: true });
}
