import { Priority, TicketStatus } from "@prisma/client";

export const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Новая",
  IN_PROGRESS: "В работе",
  WAITING_RESPONSE: "Ждёт ответа",
  RESOLVED: "Решена",
  CLOSED: "Закрыта",
};

export const priorityLabels: Record<Priority, string> = {
  LOW: "Низкий",
  MEDIUM: "Средний",
  HIGH: "Высокий",
  CRITICAL: "Критичный",
};

export const roleLabels = {
  USER: "Пользователь",
  AGENT: "Агент поддержки",
  ADMIN: "Администратор",
} as const;

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const categories = [
  "Общее",
  "Компьютер / ПО",
  "Сеть / Интернет",
  "Почта",
  "Принтеры",
  "Учётные записи",
  "Доступы",
];
