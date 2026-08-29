'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PriorityBadge, StatusBadge } from "@/components/Badges";
import { Stars } from "@/components/Stars";
import { formatDate, roleLabels } from "@/lib/labels";
import { TicketDeleteButton } from "@/components/TicketAdminActions";

type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

type ChatMessage = {
  id: string;
  body: string;
  isInternal?: boolean;
  createdAt: string;
  author: { id: string; name: string; role: keyof typeof roleLabels } | null;
  source?: "WEB" | "TELEGRAM";
  externalAuthorName?: string | null;
  attachments: Attachment[];
};

type Ticket = {
  id: string;
  number: number;
  title: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_RESPONSE" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: string;
  store: string | null;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  source: "WEB" | "TELEGRAM";
  telegramUsername: string | null;
  createdAt: string;
  closedAt: string | null;
  authorId: string | null;
  author: { id: string; name: string; email: string; department: string | null } | null;
  assignee: { id: string; name: string; email: string } | null;
  attachments: Attachment[];
  rating: { score: number; comment: string | null } | null;
};

type Me = { id: string; role: string; name: string };

const POLL_MS = 4000;

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function timeOnly(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(value: string) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Сегодня";
  if (same(d, yesterday)) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

function AttachmentLink({ a }: { a: Attachment }) {
  return (
    <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="chat-file">
      <span aria-hidden="true">📎</span>
      <span className="chat-file-name">{a.filename}</span>
      <span className="chat-file-size">{Math.max(1, Math.round(a.size / 1024))} КБ</span>
    </a>
  );
}

export default function TicketDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [score, setScore] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [draft, setDraft] = useState("");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(true);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastAtRef = useRef<string | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const stickyRef = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const loadTicket = useCallback(async () => {
    const [tRes, cRes, meRes] = await Promise.all([
      fetch(`/api/tickets/${id}`),
      fetch(`/api/tickets/${id}/comments?limit=100`),
      fetch("/api/auth/me"),
    ]);
    if (meRes.ok) setMe(await meRes.json());
    if (!tRes.ok) {
      setError("Заявка не найдена");
      return;
    }
    const data: Ticket = await tRes.json();
    setTicket(data);
    const commentData: { comments: ChatMessage[]; hasMore?: boolean } = cRes.ok ? await cRes.json() : { comments: [] };
    setMessages(commentData.comments);
    setHasOlderMessages(!!commentData.hasMore);
    lastAtRef.current = commentData.comments.at(-1)?.createdAt ?? null;
    lastIdRef.current = commentData.comments.at(-1)?.id ?? null;
    setTimeout(() => scrollToBottom(false), 50);
  }, [id, scrollToBottom]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  // Real-time: инкрементальный поллинг новых сообщений
  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;

    async function tick() {
      if (document.hidden) return;
      try {
        const url = lastAtRef.current
          ? `/api/tickets/${id}/comments?since=${encodeURIComponent(lastAtRef.current)}${lastIdRef.current ? `&afterId=${encodeURIComponent(lastIdRef.current)}` : ""}`
          : `/api/tickets/${id}/comments`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          setLive(false);
          return;
        }
        setLive(true);
        const data: { comments: ChatMessage[]; status: Ticket["status"] } = await res.json();
        if (cancelled) return;
        if (data.comments.length > 0) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            return [...prev, ...data.comments.filter((c) => !seen.has(c.id))];
          });
          lastAtRef.current = data.comments.at(-1)!.createdAt;
          lastIdRef.current = data.comments.at(-1)!.id;
          if (stickyRef.current) setTimeout(() => scrollToBottom(), 30);
        }
        setTicket((prev) => (prev && prev.status !== data.status ? { ...prev, status: data.status } : prev));
      } catch {
        setLive(false);
      }
    }

    const timer = setInterval(tick, POLL_MS);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [id, ticket, scrollToBottom]);

  async function loadOlderMessages() {
    const oldest = messages[0]?.createdAt;
    if (!oldest || loadingOlder || !hasOlderMessages) return;
    setLoadingOlder(true);
    try {
      const oldestId = messages[0]?.id;
      const res = await fetch(`/api/tickets/${id}/comments?before=${encodeURIComponent(oldest)}${oldestId ? `&beforeId=${encodeURIComponent(oldestId)}` : ""}&limit=100`, { cache: "no-store" });
      if (!res.ok) return;
      const data: { comments: ChatMessage[]; hasMore?: boolean } = await res.json();
      const stream = streamRef.current;
      const previousHeight = stream?.scrollHeight ?? 0;
      const previousTop = stream?.scrollTop ?? 0;
      setMessages((prev) => [...data.comments, ...prev.filter((m) => !data.comments.some((c) => c.id === m.id))]);
      setHasOlderMessages(!!data.hasMore);
      requestAnimationFrame(() => {
        if (stream) stream.scrollTop = previousTop + (stream.scrollHeight - previousHeight);
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  const isStaff = me?.role === "AGENT" || me?.role === "ADMIN";
  const isAuthor = Boolean(me && ticket && me.id === ticket.authorId);

  async function updateTicket(payload: Record<string, unknown>) {
    setError("");
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Ошибка обновления");
      return;
    }
    await loadTicket();
  }

  async function sendMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!me) {
      setError("Отвечать могут только зарегистрированные пользователи");
      return;
    }
    if (!draft.trim() && fileNames.length === 0) return;

    setSending(true);
    setError("");
    const fd = new FormData(formRef.current!);
    fd.set("body", draft.trim());
    fd.set("isInternal", internal ? "true" : "false");

    const res = await fetch(`/api/tickets/${id}/comments`, { method: "POST", body: fd });
    setSending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось отправить сообщение");
      return;
    }
    const created: ChatMessage = await res.json();
    setMessages((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
    lastAtRef.current = created.createdAt;
    lastIdRef.current = created.id;
    setDraft("");
    setFileNames([]);
    formRef.current?.reset();
    stickyRef.current = true;
    setTimeout(() => scrollToBottom(), 30);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  async function sendRating(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch(`/api/tickets/${id}/rating`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, comment: ratingComment || undefined }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось сохранить оценку");
      return;
    }
    await loadTicket();
  }

  if (!ticket) {
    return (
      <section className="section" style={{ paddingTop: "1.5rem" }}>
        <p className="muted">{error || "Загрузка..."}</p>
      </section>
    );
  }

  const authorName = ticket.author?.name || ticket.guestName || "Гость";
  const authorContact = ticket.author?.email || ticket.guestPhone || ticket.guestEmail || "Контакт не указан";

  let lastDay = "";

  return (
    <section className="section ticket-page">
      <div className="section-head">
        <div>
          <h2>
            #{ticket.number} · {ticket.title}
          </h2>
          <p>
            {ticket.category} · создана {formatDate(ticket.createdAt)}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
        </div>
      </div>

      {error && (
        <div className="error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <div className="ticket-layout">
        {/* ------- ЧАТ ------- */}
        <div className="chat">
          <div className="chat-head">
            <div className="chat-head-main">
              <span className="chat-avatar chat-avatar-agent">{initials(ticket.assignee?.name || "IT")}</span>
              <div>
                <strong>Переписка по заявке</strong>
                <div className="muted chat-head-sub">
                  {ticket.assignee ? `Исполнитель: ${ticket.assignee.name}` : "Исполнитель ещё не назначен"}
                </div>
              </div>
            </div>
            <span className={`live-dot ${live ? "on" : "off"}`}>{live ? "онлайн" : "нет связи"}</span>
          </div>

          <div
            className="chat-stream"
            ref={streamRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            <div className="chat-day">{dayLabel(ticket.createdAt)}</div>
            <div className="chat-row incoming">
              <span className="chat-avatar">{initials(authorName)}</span>
              <div className="chat-bubble">
                <div className="chat-meta">
                  <strong>{authorName}</strong>
                  <span>Первичное обращение · {timeOnly(ticket.createdAt)}</span>
                </div>
                <p className="chat-text">{ticket.description}</p>
                {ticket.attachments.length > 0 && (
                  <div className="chat-files">
                    {ticket.attachments.map((a) => (
                      <AttachmentLink key={a.id} a={a} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {messages.map((m) => {
              const mine = Boolean(me && m.author && me.id === m.author.id && m.source !== "TELEGRAM");
              const messageName = m.source === "TELEGRAM" ? (m.externalAuthorName || m.author?.name || "Пользователь Telegram") : (m.author?.name || "Пользователь");
              const messageRole = m.source === "TELEGRAM" ? "Telegram" : (m.author ? roleLabels[m.author.role] : "Пользователь");
              const isAgentMessage = m.source !== "TELEGRAM" && m.author?.role !== "USER";
              const day = dayLabel(m.createdAt);
              const showDay = day !== lastDay;
              lastDay = day;
              return (
                <div key={m.id}>
                  {showDay && <div className="chat-day">{day}</div>}
                  <div className={`chat-row ${mine ? "outgoing" : "incoming"}`}>
                    {!mine && (
                      <span className={`chat-avatar ${isAgentMessage ? "chat-avatar-agent" : ""}`}>
                        {initials(messageName)}
                      </span>
                    )}
                    <div className={`chat-bubble ${m.isInternal ? "internal" : ""}`}>
                      <div className="chat-meta">
                        <strong>{mine ? "Вы" : messageName}</strong>
                        <span>
                          {messageRole} · {timeOnly(m.createdAt)}
                          {m.isInternal ? " · внутренняя заметка" : ""}
                        </span>
                      </div>
                      {m.body && <p className="chat-text">{m.body}</p>}
                      {m.attachments.length > 0 && (
                        <div className="chat-files">
                          {m.attachments.map((a) => (
                            <AttachmentLink key={a.id} a={a} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {messages.length === 0 && <p className="muted chat-empty">Ответов пока нет — напишите первым.</p>}
          </div>

          {me ? (
            <form className="chat-composer" ref={formRef} onSubmit={sendMessage}>
              <textarea
                name="body"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Напишите сообщение…  (Enter — отправить, Shift+Enter — новая строка)"
                rows={1}
              />
              <div className="chat-composer-actions">
                <label className="chat-attach">
                  <input
                    name="files"
                    type="file"
                    multiple
                    onChange={(e) => setFileNames(Array.from(e.target.files || []).map((file) => file.name))}
                  />
                  <span>📎 {fileNames.length ? `${fileNames.length} файл(ов)` : "Файлы"}</span>
                </label>
                {isStaff && (
                  <label className="chat-internal">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(e) => setInternal(e.target.checked)}
                    />
                    Внутренняя заметка
                  </label>
                )}
                <button className="btn btn-primary chat-send" type="submit" disabled={sending}>
                  {sending ? "Отправка…" : "Отправить"}
                </button>
              </div>
            </form>
          ) : (
            <p className="muted chat-empty">
              Чтобы писать в чат,{" "}
              <a href="/login" style={{ textDecoration: "underline" }}>
                войдите в систему
              </a>
              .
            </p>
          )}
        </div>

        {/* ------- БОКОВАЯ ПАНЕЛЬ ------- */}
        <aside className="ticket-aside stack">
          <div className="card stack">
            <strong>Детали заявки</strong>
            <div className="kv">
              <span>Автор</span>
              <span>
                {authorName}
                <div className="muted" style={{ fontSize: "0.82rem" }}>
                  {authorContact}
                </div>
              </span>
            </div>
            {ticket.source === "TELEGRAM" && (
              <div className="kv">
                <span>Источник</span>
                <span>Telegram{ticket.telegramUsername ? ` · @${ticket.telegramUsername}` : ""}</span>
              </div>
            )}
            {ticket.store && (
              <div className="kv">
                <span>Магазин</span>
                <span>{ticket.store}</span>
              </div>
            )}
            {ticket.author?.department && (
              <div className="kv">
                <span>Отдел</span>
                <span>{ticket.author.department}</span>
              </div>
            )}
            <div className="kv">
              <span>Исполнитель</span>
              <span>{ticket.assignee?.name || "не назначен"}</span>
            </div>
            <div className="kv">
              <span>Категория</span>
              <span>{ticket.category}</span>
            </div>
            {ticket.closedAt && (
              <div className="kv">
                <span>Закрыта</span>
                <span>{formatDate(ticket.closedAt)}</span>
              </div>
            )}
          </div>

          {isStaff && (
            <div className="card stack">
              <strong>Действия IT</strong>
              <div className="ticket-actions">
                {ticket.status !== "OPEN" && ticket.status !== "CLOSED" && (
                  <button className="btn btn-secondary" type="button" onClick={() => updateTicket({ status: "OPEN" })}>Вернуть в «Новая»</button>
                )}
                {ticket.status === "CLOSED" && me?.role === "ADMIN" && (
                  <button className="btn btn-secondary" type="button" onClick={() => updateTicket({ status: "OPEN" })}>Открыть повторно</button>
                )}
                {ticket.status === "CLOSED" && me?.role !== "ADMIN" && (
                  <div className="ticket-locked-note">🔒 Заявка закрыта. Повторное открытие доступно только администратору.</div>
                )}
                {ticket.status !== "CLOSED" && ticket.status !== "IN_PROGRESS" && (
                  <button className="btn btn-secondary" type="button" onClick={() => updateTicket({ status: "IN_PROGRESS", assigneeId: me?.id })}>Взять в работу</button>
                )}
                {ticket.status !== "CLOSED" && ticket.status !== "WAITING_RESPONSE" && (
                  <button className="btn btn-secondary" type="button" onClick={() => updateTicket({ status: "WAITING_RESPONSE" })}>Ждёт ответа</button>
                )}
                {ticket.status !== "CLOSED" && ticket.status !== "RESOLVED" && (
                  <button className="btn btn-secondary" type="button" onClick={() => updateTicket({ status: "RESOLVED" })}>Решена</button>
                )}
                {ticket.status !== "CLOSED" && (
                  <button className="btn btn-primary" type="button" onClick={() => updateTicket({ status: "CLOSED", assigneeId: me?.id })}>Закрыть</button>
                )}
                {me?.role === "ADMIN" && <TicketDeleteButton ticketId={ticket.id} />}
              </div>
            </div>
          )}

          {isAuthor && ticket.status === "CLOSED" && !ticket.rating && (
            <form className="card form" onSubmit={sendRating}>
              <strong>Оцените работу IT</strong>
              <Stars value={score} onChange={setScore} />
              <label>
                Комментарий к оценке
                <textarea
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value)}
                  placeholder="Спасибо, всё быстро починили"
                />
              </label>
              <button className="btn btn-primary" type="submit">
                Отправить оценку
              </button>
            </form>
          )}

          {ticket.rating && (
            <div className="card stack">
              <strong>Оценка пользователя</strong>
              <Stars value={ticket.rating.score} readOnly />
              {ticket.rating.comment && <p className="muted">{ticket.rating.comment}</p>}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
