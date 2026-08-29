import { readStoredFile } from "@/lib/storage";

const statusLabels: Record<string, string> = {
  OPEN: "Новая",
  IN_PROGRESS: "В работе",
  WAITING_RESPONSE: "Ждёт ответа",
  RESOLVED: "Решена",
  CLOSED: "Закрыта",
};

function token() {
  return (process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

async function telegramApi(method: string, body: Record<string, unknown>) {
  const botToken = token();
  if (!botToken) return null;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    throw new Error(`Telegram ${method} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data.result;
}

export async function sendTelegramMessage(chatId: string, text: string, ticketId?: string) {
  if (!token() || !chatId) return null;
  const reply_markup = ticketId
    ? { inline_keyboard: [[{ text: "💬 Ответить по этой заявке", callback_data: `ticket:reply:${ticketId}` }]] }
    : undefined;
  return telegramApi("sendMessage", { chat_id: chatId, text, reply_markup });
}

export async function sendTelegramAttachment(chatId: string, attachment: { filename: string; storedName: string; mimeType: string }) {
  const botToken = token();
  if (!botToken || !chatId) return null;
  const buffer = await readStoredFile(attachment.storedName);
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("document", new Blob([buffer], { type: attachment.mimeType || "application/octet-stream" }), attachment.filename);
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    throw new Error(`Telegram sendDocument failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data.result;
}

export async function notifyTelegramComment(ticket: {
  id: string;
  number: number;
  source: string;
  telegramChatId: string | null;
}, comment: {
  body: string;
  isInternal: boolean;
  author: { name: string } | null;
  attachments: Array<{ filename: string; storedName: string; mimeType: string }>;
}) {
  if (ticket.source !== "TELEGRAM" || !ticket.telegramChatId || comment.isInternal) return;
  const author = comment.author?.name || "IT-поддержка";
  const body = comment.body?.trim();
  const text = body
    ? `Xdesk · заявка X-${ticket.number}\n\n${author}:\n${body}`
    : `Xdesk · заявка X-${ticket.number}\n\n${author} отправил файл.`;
  await sendTelegramMessage(ticket.telegramChatId, text, ticket.id);
  for (const attachment of comment.attachments || []) {
    await sendTelegramAttachment(ticket.telegramChatId, attachment);
  }
}

export async function notifyTelegramStatus(ticket: {
  id: string;
  number: number;
  title: string;
  source: string;
  telegramChatId: string | null;
  status: string;
}) {
  if (ticket.source !== "TELEGRAM" || !ticket.telegramChatId) return;
  const label = statusLabels[ticket.status] || ticket.status;

  if (ticket.status === "CLOSED") {
    await telegramApi("sendMessage", {
      chat_id: ticket.telegramChatId,
      text: `Xdesk · заявка X-${ticket.number}\n\nСтатус изменён: ${label}\n${ticket.title}\n\nОцените оказанную вам поддержку:`,
      reply_markup: {
        inline_keyboard: [[1, 2, 3, 4, 5].map((score) => ({
          text: `${score} ⭐`,
          callback_data: `rating:${ticket.id}:${score}`,
        }))],
      },
    });
    return;
  }

  await sendTelegramMessage(
    ticket.telegramChatId,
    `Xdesk · заявка X-${ticket.number}\n\nСтатус изменён: ${label}\n${ticket.title}`,
    ticket.id,
  );
}
