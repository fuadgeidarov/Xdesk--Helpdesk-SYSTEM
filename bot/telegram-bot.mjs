const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const enabled = String(process.env.TELEGRAM_BOT_ENABLED || "true").toLowerCase() !== "false";
const xdeskBase = (process.env.XDESK_INTERNAL_URL || "http://app:3000").replace(/\/$/, "");

if (!enabled) {
  console.log("[Telegram] Bot disabled by TELEGRAM_BOT_ENABLED=false");
  process.exit(0);
}
if (!token) {
  console.error("[Telegram] TELEGRAM_BOT_TOKEN is missing.");
  process.exit(1);
}

const apiBase = `https://api.telegram.org/bot${token}`;
const fileBase = `https://api.telegram.org/file/bot${token}`;
let offset = 0;
let stopping = false;
const sessions = new Map();
const selectedTickets = new Map();
const pendingReplies = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stores = [
  "Магазин 1", "Магазин 2", "Магазин 3", "Офис", "Склад", "Производство",
];

const priorityLabels = { LOW: "Низкий", MEDIUM: "Средний", HIGH: "Высокий", CRITICAL: "Критичный" };
const statusLabels = { OPEN: "Новая", IN_PROGRESS: "В работе", WAITING_RESPONSE: "Ждёт ответа", RESOLVED: "Решена", CLOSED: "Закрыта" };

const menu = {
  keyboard: [
    [{ text: "📝 Создать заявку" }],
    [{ text: "📋 Мои заявки" }, { text: "ℹ️ Помощь" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const phoneKeyboard = {
  keyboard: [
    [{ text: "📱 Поделиться номером", request_contact: true }],
    [{ text: "⌨️ Ввести номер вручную" }],
    [{ text: "❌ Отмена" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
};

function inlineKeyboard(rows) { return { inline_keyboard: rows }; }

async function api(method, body = {}) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error(`${method} failed: ${response.status} ${JSON.stringify(data)}`);
  return data.result;
}

async function xdesk(path, options = {}) {
  const headers = { "x-telegram-bot-token": token, ...(options.headers || {}) };
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!isForm) headers["content-type"] = "application/json";
  const response = await fetch(`${xdeskBase}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(options.timeout || 30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Xdesk HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function sendMessage(chatId, text, extra = {}) {
  return api("sendMessage", { chat_id: chatId, text, reply_markup: extra.reply_markup, parse_mode: extra.parse_mode });
}
async function editMessage(chatId, messageId, text, replyMarkup) {
  return api("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup }).catch(() => null);
}
async function answerCallbackQuery(id, text) {
  return api("answerCallbackQuery", { callback_query_id: id, text }).catch(() => null);
}
function displayName(from) {
  return [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim() || from?.username || "Пользователь Telegram";
}

function startSession(message) {
  const chatId = String(message.chat.id);
  sessions.set(chatId, {
    step: "store",
    telegramUserId: String(message.from?.id || ""),
    telegramUsername: message.from?.username || null,
    displayName: displayName(message.from),
    store: null, phone: null, title: null, description: null, priority: "MEDIUM",
  });
  return sessions.get(chatId);
}

function storeKeyboard() {
  const rows = [];
  for (let i = 0; i < stores.length; i += 2) {
    rows.push(stores.slice(i, i + 2).map((store, idx) => ({ text: store, callback_data: `store:${i + idx}` })));
  }
  rows.push([{ text: "❌ Отмена", callback_data: "cancel" }]);
  return inlineKeyboard(rows);
}
function priorityKeyboard() {
  return inlineKeyboard([
    [{ text: "🟢 Низкий", callback_data: "priority:LOW" }, { text: "🔵 Средний", callback_data: "priority:MEDIUM" }],
    [{ text: "🟠 Высокий", callback_data: "priority:HIGH" }, { text: "🔴 Критичный", callback_data: "priority:CRITICAL" }],
    [{ text: "❌ Отмена", callback_data: "cancel" }],
  ]);
}
function confirmationText(session) {
  return [
    "Проверьте заявку:", "", `Магазин: ${session.store}`, `Телефон: ${session.phone}`,
    `Тема: ${session.title}`, `Приоритет: ${priorityLabels[session.priority]}`, "", "Описание:", session.description,
  ].join("\n");
}

async function beginTicket(message) {
  startSession(message);
  pendingReplies.delete(String(message.chat.id));
  await sendMessage(message.chat.id, "Выберите магазин:", { reply_markup: storeKeyboard() });
}
async function cancel(chatId) {
  sessions.delete(String(chatId));
  pendingReplies.delete(String(chatId));
  await sendMessage(chatId, "Создание заявки отменено.", { reply_markup: menu });
}

async function getTickets(chatId) {
  const data = await xdesk(`/api/integrations/telegram/tickets?chatId=${encodeURIComponent(String(chatId))}`);
  return data.tickets || [];
}

async function showMyTickets(chatId) {
  try {
    const tickets = await getTickets(chatId);
    if (!tickets.length) {
      await sendMessage(chatId, "У вас пока нет заявок, созданных через этого Telegram-бота.", { reply_markup: menu });
      return;
    }
    const lines = ["Ваши последние заявки:", ""];
    const rows = [];
    for (const ticket of tickets) {
      lines.push(`X-${ticket.number} · ${statusLabels[ticket.status] || ticket.status}`);
      lines.push(`${ticket.title}${ticket.store ? ` · ${ticket.store}` : ""}`);
      lines.push("");
      if (ticket.status !== "CLOSED") rows.push([{ text: `💬 X-${ticket.number} · ${ticket.title.slice(0, 32)}`, callback_data: `ticket:reply:${ticket.id}` }]);
    }
    await sendMessage(chatId, lines.join("\n").trim(), { reply_markup: rows.length ? inlineKeyboard(rows) : menu });
    if (!rows.length) await sendMessage(chatId, "Активных заявок нет. Для нового обращения нажмите «📝 Создать заявку».", { reply_markup: menu });
  } catch (error) {
    console.error("[Telegram] My tickets error:", error?.message || error);
    await sendMessage(chatId, "Не удалось получить список заявок. Попробуйте ещё раз через минуту.", { reply_markup: menu });
  }
}

async function submitTicket(chatId, session) {
  const ticket = await xdesk("/api/integrations/telegram/tickets", {
    method: "POST",
    body: JSON.stringify({
      chatId: String(chatId), telegramUserId: session.telegramUserId, telegramUsername: session.telegramUsername,
      displayName: session.displayName, phone: session.phone, store: session.store, title: session.title,
      description: session.description, priority: session.priority,
    }),
  });
  sessions.delete(String(chatId));
  selectedTickets.set(String(chatId), ticket.id);
  await sendMessage(chatId,
    `✅ Заявка X-${ticket.number} создана.\n\n${ticket.title}\nМагазин: ${ticket.store}\nСтатус: Новая\nПриоритет: ${priorityLabels[ticket.priority] || ticket.priority}\n\nIT-поддержка получила обращение. Теперь обычные сообщения в этот чат будут добавляться в эту заявку.`,
    { reply_markup: menu },
  );
}

async function chooseTicketForReply(chatId, messageToKeep = null) {
  const tickets = (await getTickets(chatId)).filter((t) => t.status !== "CLOSED");
  if (!tickets.length) {
    await sendMessage(chatId, "У вас нет активных заявок. Нажмите «📝 Создать заявку».", { reply_markup: menu });
    return null;
  }
  if (tickets.length === 1) {
    selectedTickets.set(String(chatId), tickets[0].id);
    return tickets[0].id;
  }
  if (messageToKeep) pendingReplies.set(String(chatId), messageToKeep);
  await sendMessage(chatId, "У вас несколько активных заявок. Выберите, к какой заявке относится сообщение:", {
    reply_markup: inlineKeyboard(tickets.map((t) => [{ text: `X-${t.number} · ${t.title.slice(0, 35)}`, callback_data: `ticket:reply:${t.id}` }])),
  });
  return null;
}

async function downloadTelegramFile(fileId) {
  const info = await api("getFile", { file_id: fileId });
  if (!info?.file_path) throw new Error("Telegram did not return file_path");
  const response = await fetch(`${fileBase}/${info.file_path}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function incomingAttachment(message) {
  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo[message.photo.length - 1];
    return { fileId: photo.file_id, filename: `telegram-photo-${message.message_id}.jpg`, mimeType: "image/jpeg" };
  }
  if (message.document?.file_id) {
    return {
      fileId: message.document.file_id,
      filename: String(message.document.file_name || `telegram-file-${message.message_id}`).slice(0, 180),
      mimeType: message.document.mime_type || "application/octet-stream",
    };
  }
  return null;
}

async function submitReply(chatId, message, ticketId) {
  const attachment = incomingAttachment(message);
  const body = String(message.text || message.caption || "").trim();
  if (!body && !attachment) return false;
  const externalMessageId = `telegram:${chatId}:${message.message_id}`;
  const name = displayName(message.from);
  try {
    let result;
    if (attachment) {
      const bytes = await downloadTelegramFile(attachment.fileId);
      if (bytes.length > 15 * 1024 * 1024) {
        await sendMessage(chatId, "Файл больше 15 МБ. Отправьте файл меньшего размера.", { reply_markup: menu });
        return true;
      }
      const form = new FormData();
      form.set("chatId", String(chatId));
      form.set("ticketId", ticketId || "");
      form.set("displayName", name);
      form.set("externalMessageId", externalMessageId);
      form.set("body", body);
      form.set("file", new Blob([bytes], { type: attachment.mimeType }), attachment.filename);
      result = await xdesk("/api/integrations/telegram/replies", { method: "POST", body: form, timeout: 45000 });
    } else {
      result = await xdesk("/api/integrations/telegram/replies", {
        method: "POST",
        body: JSON.stringify({ chatId: String(chatId), ticketId: ticketId || null, displayName: name, externalMessageId, body }),
      });
    }
    if (result?.ticket?.id) selectedTickets.set(String(chatId), result.ticket.id);
    if (!result?.duplicate) await sendMessage(chatId, `✅ Сообщение добавлено в заявку X-${result.ticket.number}.`, { reply_markup: menu });
    return true;
  } catch (error) {
    if (error?.data?.error === "SELECT_TICKET") {
      await chooseTicketForReply(chatId, message);
      return true;
    }
    if (error?.data?.error === "TICKET_CLOSED") {
      selectedTickets.delete(String(chatId));
      await sendMessage(chatId, `Заявка X-${error.data.number} уже закрыта. Выберите другую активную заявку или создайте новую.`, { reply_markup: menu });
      return true;
    }
    console.error("[Telegram] Reply delivery error:", error?.message || error);
    await sendMessage(chatId, "Не удалось передать сообщение в Xdesk. Попробуйте ещё раз через минуту.", { reply_markup: menu });
    return true;
  }
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  if (!chatId) return;
  const data = String(query.data || "");
  const key = String(chatId);

  if (data.startsWith("rating:")) {
    const parts = data.split(":");
    const ticketId = parts[1] || "";
    const score = Number(parts[2]);
    if (!ticketId || !Number.isInteger(score) || score < 1 || score > 5) {
      await answerCallbackQuery(query.id, "Некорректная оценка");
      return;
    }
    try {
      const result = await xdesk("/api/integrations/telegram/ratings", {
        method: "POST",
        body: JSON.stringify({ chatId: key, ticketId, score }),
      });
      const savedScore = Number(result?.rating?.score || result?.score || score);
      await answerCallbackQuery(query.id, result?.duplicate ? `Оценка уже сохранена: ${savedScore} ⭐` : `Спасибо! Оценка ${savedScore} ⭐ сохранена`);
      const original = String(query.message?.text || "").replace(/\n\nСпасибо! Ваша оценка:.*$/s, "");
      await editMessage(chatId, query.message.message_id, `${original}\n\nСпасибо! Ваша оценка: ${savedScore} ⭐`, undefined);
    } catch (error) {
      console.error("[Telegram] Rating error:", error?.message || error);
      await answerCallbackQuery(query.id, error?.data?.error || "Не удалось сохранить оценку");
    }
    return;
  }

  if (data.startsWith("ticket:reply:")) {
    const ticketId = data.slice("ticket:reply:".length);
    selectedTickets.set(key, ticketId);
    await answerCallbackQuery(query.id, "Заявка выбрана");
    await sendMessage(chatId, "Эта заявка выбрана для переписки. Отправьте текст, фото или документ — сообщение появится в Xdesk.", { reply_markup: menu });
    const pending = pendingReplies.get(key);
    if (pending) {
      pendingReplies.delete(key);
      await submitReply(chatId, pending, ticketId);
    }
    return;
  }

  if (data === "cancel") {
    await answerCallbackQuery(query.id, "Отменено");
    await cancel(chatId);
    return;
  }

  const session = sessions.get(key);
  if (!session) {
    await answerCallbackQuery(query.id, "Сессия устарела");
    await sendMessage(chatId, "Мастер заявки был перезапущен. Нажмите «📝 Создать заявку» ещё раз.", { reply_markup: menu });
    return;
  }

  if (data.startsWith("store:") && session.step === "store") {
    const index = Number(data.slice("store:".length));
    const store = stores[index];
    if (!store) return answerCallbackQuery(query.id, "Некорректный магазин");
    session.store = store;
    session.step = "phone";
    await answerCallbackQuery(query.id, store);
    await editMessage(chatId, query.message.message_id, `Магазин: ${store}`, undefined);
    await sendMessage(chatId, "Укажите номер телефона. Самый быстрый вариант — нажать «📱 Поделиться номером».", { reply_markup: phoneKeyboard });
    return;
  }

  if (data.startsWith("priority:") && session.step === "priority") {
    const priority = data.slice("priority:".length);
    if (!priorityLabels[priority]) return answerCallbackQuery(query.id, "Некорректный приоритет");
    session.priority = priority;
    session.step = "confirm";
    await answerCallbackQuery(query.id, priorityLabels[priority]);
    await editMessage(chatId, query.message.message_id, `Приоритет: ${priorityLabels[priority]}`, undefined);
    await sendMessage(chatId, confirmationText(session), {
      reply_markup: inlineKeyboard([[{ text: "✅ Создать заявку", callback_data: "confirm:create" }], [{ text: "❌ Отмена", callback_data: "cancel" }]]),
    });
    return;
  }

  if (data === "confirm:create" && session.step === "confirm") {
    session.step = "submitting";
    await answerCallbackQuery(query.id, "Создаю заявку…");
    try {
      await submitTicket(chatId, session);
      await editMessage(chatId, query.message.message_id, "✅ Заявка отправлена в Xdesk.", undefined);
    } catch (error) {
      console.error("[Telegram] Ticket create error:", error?.message || error);
      session.step = "confirm";
      await sendMessage(chatId, "Не удалось создать заявку в Xdesk. Данные сохранены — попробуйте ещё раз.", {
        reply_markup: inlineKeyboard([[{ text: "🔄 Повторить", callback_data: "confirm:create" }], [{ text: "❌ Отмена", callback_data: "cancel" }]]),
      });
    }
  }
}

async function handleMessage(message) {
  if (!message?.chat?.id) return;
  const chatId = message.chat.id;
  const key = String(chatId);
  const text = (message.text || "").trim();
  const session = sessions.get(key);

  if (text === "/start" || text === "/menu") {
    sessions.delete(key);
    pendingReplies.delete(key);
    const name = message.from?.first_name ? `, ${message.from.first_name}` : "";
    await sendMessage(chatId, `Здравствуйте${name}!\n\nЭто бот IT-поддержки ${process.env.BOT_COMPANY_NAME || "Xdesk"}.\nВыберите действие в меню ниже.`, { reply_markup: menu });
    return;
  }
  if (text === "/help" || text === "ℹ️ Помощь") {
    await sendMessage(chatId, "Через этого бота можно создать заявку в Xdesk, посмотреть свои обращения и вести переписку с IT-поддержкой.\n\nПосле создания заявки обычный текст, фото или документ можно отправлять прямо сюда — они попадут в выбранную заявку. Если активных заявок несколько, бот предложит выбрать нужную.", { reply_markup: menu });
    return;
  }
  if (text === "❌ Отмена" || text === "/cancel") { await cancel(chatId); return; }
  if (text === "📝 Создать заявку") { await beginTicket(message); return; }
  if (text === "📋 Мои заявки") {
    sessions.delete(key);
    pendingReplies.delete(key);
    await showMyTickets(chatId);
    return;
  }

  if (session) {
    if (session.step === "phone") {
      if (message.contact?.phone_number) {
        if (message.contact.user_id && message.from?.id && Number(message.contact.user_id) !== Number(message.from.id)) {
          await sendMessage(chatId, "Пожалуйста, отправьте именно свой номер или выберите ручной ввод.", { reply_markup: phoneKeyboard });
          return;
        }
        session.phone = String(message.contact.phone_number).trim();
        session.step = "title";
        await sendMessage(chatId, `Телефон сохранён: ${session.phone}\n\nТеперь кратко укажите тему проблемы (от 3 до 140 символов).`, { reply_markup: { remove_keyboard: true } });
        return;
      }
      if (text === "⌨️ Ввести номер вручную") {
        session.step = "phone_manual";
        await sendMessage(chatId, "Введите номер телефона, например +7 700 000 00 00.", { reply_markup: { remove_keyboard: true } });
        return;
      }
      await sendMessage(chatId, "Нажмите «📱 Поделиться номером» или выберите ручной ввод.", { reply_markup: phoneKeyboard });
      return;
    }
    if (session.step === "phone_manual") {
      const digits = text.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) {
        await sendMessage(chatId, "Похоже, номер введён неверно. Введите его ещё раз, например +7 700 000 00 00.");
        return;
      }
      session.phone = text.slice(0, 40);
      session.step = "title";
      await sendMessage(chatId, "Телефон сохранён. Теперь кратко укажите тему проблемы (от 3 до 140 символов).");
      return;
    }
    if (session.step === "title") {
      if (text.length < 3 || text.length > 140) {
        await sendMessage(chatId, "Тема должна содержать от 3 до 140 символов. Попробуйте ещё раз.");
        return;
      }
      session.title = text;
      session.step = "description";
      await sendMessage(chatId, "Опишите проблему подробнее (минимум 5 символов). Что именно не работает и что вы уже пробовали?");
      return;
    }
    if (session.step === "description") {
      if (text.length < 5 || text.length > 5000) {
        await sendMessage(chatId, "Описание должно содержать от 5 до 5000 символов. Попробуйте ещё раз.");
        return;
      }
      session.description = text;
      session.step = "priority";
      await sendMessage(chatId, "Выберите приоритет заявки:", { reply_markup: priorityKeyboard() });
      return;
    }
    if (["priority", "confirm", "submitting"].includes(session.step)) {
      await sendMessage(chatId, "Используйте кнопки под последним сообщением.");
      return;
    }
  }

  const hasReplyContent = Boolean(text || message.caption || message.photo?.length || message.document?.file_id);
  if (hasReplyContent) {
    let ticketId = selectedTickets.get(key) || null;
    if (!ticketId) ticketId = await chooseTicketForReply(chatId, message);
    if (ticketId) await submitReply(chatId, message, ticketId);
    return;
  }

  await sendMessage(chatId, "Выберите действие с помощью кнопок меню.", { reply_markup: menu });
}

async function poll() {
  while (!stopping) {
    try {
      const updates = await api("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        try {
          if (update.callback_query) await handleCallback(update.callback_query);
          else if (update.message) await handleMessage(update.message);
        } catch (error) {
          console.error("[Telegram] Update handling error:", error?.message || error);
        }
      }
    } catch (error) {
      if (stopping) break;
      console.error("[Telegram] Polling error:", error?.message || error);
      await sleep(3000);
    }
  }
}

async function main() {
  const me = await api("getMe");
  console.log(`[Telegram] Connected as @${me.username || me.first_name} (${me.id})`);
  await api("deleteWebhook", { drop_pending_updates: false });
  console.log(`[Telegram] Xdesk internal API: ${xdeskBase}`);
  console.log("[Telegram] Long polling started. Two-way Xdesk chat enabled.");
  await poll();
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { stopping = true; console.log(`[Telegram] ${signal} received, stopping...`); });
}

main().catch((error) => {
  console.error("[Telegram] Fatal error:", error?.message || error);
  process.exit(1);
});
