import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient({ log: ["error"] });
function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

const ticketCount = boundedInt(process.env.DB_STRESS_TICKETS, 50, 1, 100);
const commentsPerTicket = boundedInt(process.env.DB_STRESS_COMMENTS_PER_TICKET, 3, 0, 10);
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `db-stress-${runId}@xdesk.local`;

async function main() {
  console.log(`Stress test: ${ticketCount} concurrent tickets, ${commentsPerTicket} comments per ticket`);
  const user = await prisma.user.create({
    data: {
      email,
      name: "DB Stress Test",
      passwordHash: "stress-test-not-for-login",
      role: Role.AGENT,
      department: "IT",
      store: "Офис",
    },
  });

  const started = Date.now();
  let ticketIds: string[] = [];
  try {
    const created = await Promise.all(
      Array.from({ length: ticketCount }, (_, i) =>
        prisma.ticket.create({
          data: {
            title: `DB stress ${runId} #${i + 1}`,
            description: "Temporary database load-test ticket",
            priority: i % 10 === 0 ? "HIGH" : "MEDIUM",
            category: "Тест",
            store: "Офис",
            authorId: user.id,
            assigneeId: user.id,
          },
          select: { id: true },
        }),
      ),
    );
    ticketIds = created.map((row) => row.id);
    const ticketMs = Date.now() - started;
    console.log(`Created ${ticketIds.length} tickets in ${ticketMs} ms`);

    const commentJobs = ticketIds.flatMap((ticketId) =>
      Array.from({ length: commentsPerTicket }, (_, i) => ({ ticketId, i })),
    );

    const commentStarted = Date.now();
    const concurrency = boundedInt(process.env.DB_STRESS_CONCURRENCY, 20, 1, 25);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, commentJobs.length || 1) }, async () => {
        while (true) {
          const index = cursor++;
          const job = commentJobs[index];
          if (!job) return;
          const now = new Date();
          await prisma.$transaction(async (tx) => {
            await tx.comment.create({
              data: {
                body: `Stress comment ${job.i + 1}`,
                ticketId: job.ticketId,
                authorId: user.id,
                createdAt: now,
              },
            });
            await tx.ticket.update({ where: { id: job.ticketId }, data: { lastActivityAt: now } });
          });
        }
      }),
    );
    console.log(`Created ${commentJobs.length} comments in ${Date.now() - commentStarted} ms`);

    const persistedTickets = await prisma.ticket.count({ where: { id: { in: ticketIds } } });
    const persistedComments = await prisma.comment.count({ where: { ticketId: { in: ticketIds } } });
    if (persistedTickets !== ticketCount || persistedComments !== commentJobs.length) {
      throw new Error(`Persistence mismatch: tickets ${persistedTickets}/${ticketCount}, comments ${persistedComments}/${commentJobs.length}`);
    }
    console.log(`Stress test: OK (${Date.now() - started} ms total)`);
  } finally {
    if (ticketIds.length) await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    console.log("Stress test data cleaned up");
  }
}

main()
  .catch((error) => {
    console.error("Stress test FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
