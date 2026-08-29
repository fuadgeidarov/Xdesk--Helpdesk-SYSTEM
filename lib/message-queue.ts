/**
 * Lightweight in-process queue for non-critical post-comment work.
 * The comment itself is persisted transactionally in PostgreSQL first.
 * This prevents chat writes from waiting on secondary work such as cache
 * invalidation, notifications or audit integrations.
 */
type Job = { ticketId: string; commentId: string };

const queue: Job[] = [];
let draining = false;

export function enqueueCommentSideEffects(job: Job): void {
  queue.push(job);
  void drainCommentQueue();
}

async function drainCommentQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      queue.shift();
      // Reserved for notifications/webhooks/cache invalidation.
      // Deliberately no secondary DB write in the request path.
      await Promise.resolve();
    }
  } finally {
    draining = false;
  }
}
