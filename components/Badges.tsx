import { Priority, TicketStatus } from "@prisma/client";
import { priorityLabels, statusLabels } from "@/lib/labels";

export function StatusBadge({ status }: { status: TicketStatus }) {
  const map: Record<TicketStatus, string> = {
    OPEN: "open",
    IN_PROGRESS: "in_progress",
    WAITING_RESPONSE: "waiting_response",
    RESOLVED: "resolved",
    CLOSED: "closed",
  };
  return <span className={`badge ${map[status]}`}>{statusLabels[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const cls = priority === "CRITICAL" ? "critical" : priority === "HIGH" ? "high" : "";
  return <span className={`badge ${cls}`}>{priorityLabels[priority]}</span>;
}
