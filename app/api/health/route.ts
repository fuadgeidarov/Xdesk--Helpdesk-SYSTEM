import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Public callers get only a cheap liveness answer. The Docker healthcheck
  // supplies the application secret so only the local container check performs
  // a database round-trip; this prevents /api/health from becoming a public DB
  // amplification endpoint.
  const expected = process.env.AUTH_SECRET;
  const provided = req.headers.get("x-xdesk-health");
  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("database timeout")), 3000)),
    ]);
    return NextResponse.json({ ok: true, database: "up" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, database: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
