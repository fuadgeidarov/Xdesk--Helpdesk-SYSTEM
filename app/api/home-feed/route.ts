import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isStaff } from "@/lib/auth";
import { activeTicketStatuses } from "@/lib/workflow";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  const where = user
    ? isStaff(user.role)
      ? { status: { in: activeTicketStatuses } }
      : { authorId: user.id }
    : {};

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
    take: 8,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      priority: true,
      lastActivityAt: true,
    },
  });

  return NextResponse.json({
    authenticated: Boolean(user),
    staff: Boolean(user && isStaff(user.role)),
    items: tickets.map((ticket) => ({
      ...ticket,
      title: user ? ticket.title : `Обращение X-${ticket.number}`,
    })),
    serverTime: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
