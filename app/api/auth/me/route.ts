import { NextResponse } from "next/server";
import { getFullUser, jsonError } from "@/lib/auth";

export async function GET() {
  const user = await getFullUser();
  if (!user) return jsonError("Не авторизован", 401);
  return NextResponse.json(user);
}
