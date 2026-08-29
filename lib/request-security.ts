import { NextRequest, NextResponse } from "next/server";

export function rejectOversizedRequest(req: NextRequest, maxBytes: number) {
  const raw = req.headers.get("content-length");
  if (!raw) return null;
  const size = Number(raw);
  if (!Number.isFinite(size) || size < 0) return NextResponse.json({ error: "Некорректный размер запроса" }, { status: 400 });
  if (size > maxBytes) return NextResponse.json({ error: "Запрос слишком большой" }, { status: 413 });
  return null;
}
