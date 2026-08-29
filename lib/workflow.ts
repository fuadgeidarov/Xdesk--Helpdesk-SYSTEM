import { TicketStatus } from "@prisma/client";

export const ticketStatusOrder: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.IN_PROGRESS,
  TicketStatus.WAITING_RESPONSE,
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
];

export const activeTicketStatuses: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.IN_PROGRESS,
  TicketStatus.WAITING_RESPONSE,
  TicketStatus.RESOLVED,
];
