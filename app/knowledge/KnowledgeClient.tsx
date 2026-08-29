"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/labels";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge";

type KnowledgeAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

type Article = {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  category: string;
  tags: string[];
  visibility: "STAFF" | "ALL";
  isPinned: boolean;
  views: number;
  updatedAt: string;
  author: { id: string; name: string } | null;
  attachments: KnowledgeAttachment[];
};

type Me = { id: string; role: "USER" | "AGENT" | "ADMIN"; name: string } | null;
type KnowledgeResponse = { items: Article[]; counts: Record<string, number>; total: number };

const ALL_CATEGORY = "Все";

function fileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

export default function KnowledgePage() {
  const [me, setMe] = useState<Me>(null);
  const [authReady, setAuthReady] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [active, setActive] = useState<Article | null>(null);
  const [editing, setEditing] = useState<Article | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canView = Boolean(me);
  const isAdmin = me?.role === "ADMIN";

  const load = useCallback(async (query: string, selectedCategory: string) => {
    if (!canView) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (selectedCategory !== ALL_CATEGORY) params.set("category", selectedCategory);

    const res = await fetch(`/api/knowledge?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось загрузить базу знаний");
      setLoading(false);
      return;
    }

    const data: KnowledgeResponse = await res.json();
    setArticles(data.items);
    setCounts(data.counts);
    setTotal(data.total);
    setActive((prev) => {
      if (!data.items.length) return null;
      return prev ? data.items.find((item) => item.id === prev.id) || data.items[0] : data.items[0];
    });
    setLoading(false);
  }, [canView]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        setMe(value);
        setAuthReady(true);
      })
      .catch(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!canView) return;
    const timer = window.setTimeout(() => load(q, category), 250);
    return () => window.clearTimeout(timer);
  }, [q, category, canView, load]);

  const categoryTabs = useMemo(
    () => [ALL_CATEGORY, ...KNOWLEDGE_CATEGORIES],
    []
  );

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isAdmin || saving) return;
    setSaving(true);
    setError("");

    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      title: String(fd.get("title") || ""),
      summary: String(fd.get("summary") || "") || undefined,
      body: String(fd.get("body") || ""),
      category: String(fd.get("category") || "Общее"),
      isPinned: fd.get("isPinned") === "on",
      tags: String(fd.get("tags") || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    try {
      const res = await fetch(editing ? `/api/knowledge/${editing.id}` : "/api/knowledge", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Не удалось сохранить материал");
        return;
      }

      const article: Article = await res.json();
      const files = fd.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
      if (files.length) {
        const uploadData = new FormData();
        files.forEach((file) => uploadData.append("files", file));
        const upload = await fetch(`/api/knowledge/${article.id}/attachments`, { method: "POST", body: uploadData });
        if (!upload.ok) {
          const data = await upload.json().catch(() => ({}));
          setError(data.error || "Материал сохранён, но вложения загрузить не удалось");
          await load(q, category);
          return;
        }
      }

      setShowForm(false);
      setEditing(null);
      form.reset();
      await load(q, category);
      const fresh = await fetch(`/api/knowledge/${article.id}`, { cache: "no-store" });
      if (fresh.ok) setActive(await fresh.json());
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!isAdmin || !window.confirm("Удалить материал из базы знаний?")) return;
    const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось удалить материал");
      return;
    }
    setActive(null);
    await load(q, category);
  }

  async function removeAttachment(articleId: string, attachmentId: string) {
    if (!isAdmin || !window.confirm("Удалить прикреплённый файл?")) return;
    const res = await fetch(`/api/knowledge/${articleId}/attachments/${attachmentId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось удалить вложение");
      return;
    }
    await load(q, category);
  }

  if (!authReady) {
    return <section className="section"><div className="card"><p className="muted">Загрузка базы знаний…</p></div></section>;
  }

  if (!canView) {
    return (
      <section className="section">
        <div className="card kb-access-denied">
          <strong>Войдите, чтобы открыть базу знаний</strong>
          <p className="muted">Материалы доступны авторизованным пользователям Xdesk.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section kb-page">
      <div className="kb-page-head">
        <div>
          <h1>База знаний</h1>
          <p>{total} {total === 1 ? "материал" : "материалов"} · инструкции и регламенты IT-отдела</p>
        </div>
        <div className="kb-head-actions">
          <label className="kb-search-wrap">
            <span aria-hidden="true">⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по материалам…"
              aria-label="Поиск по базе знаний"
            />
          </label>
          {isAdmin && (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                setEditing(null);
                setShowForm(true);
                setError("");
              }}
            >
              + Новый материал
            </button>
          )}
        </div>
      </div>

      <div className="kb-category-tabs" role="tablist" aria-label="Категории базы знаний">
        {categoryTabs.map((item) => {
          const count = item === ALL_CATEGORY ? total : (counts[item] || 0);
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              className={`kb-category-tab ${category === item ? "active" : ""}`}
              onClick={() => setCategory(item)}
            >
              {item}
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {error && <div className="error kb-error">{error}</div>}

      {isAdmin && showForm && (
        <div className="kb-editor-overlay" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setShowForm(false);
        }}>
          <div className="card kb-editor" role="dialog" aria-modal="true" aria-label={editing ? "Редактирование материала" : "Новый материал"}>
            <div className="kb-editor-head">
              <div>
                <h2>{editing ? "Редактировать материал" : "Новый материал"}</h2>
                <p>Материал будет доступен всем авторизованным пользователям. Редактирование доступно только администраторам.</p>
              </div>
              <button className="kb-icon-btn" type="button" onClick={() => setShowForm(false)} aria-label="Закрыть">×</button>
            </div>

            <form className="form kb-editor-form" onSubmit={save}>
              <label>
                Название материала
                <input name="title" required maxLength={160} defaultValue={editing?.title} placeholder="Например: Настройка корпоративной почты" />
              </label>

              <div className="grid grid-2">
                <label>
                  Категория
                  <select name="category" defaultValue={editing?.category || "Общее"}>
                    {KNOWLEDGE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  Теги
                  <input name="tags" defaultValue={editing?.tags.join(", ")} placeholder="Outlook, почта, пароль" />
                </label>
              </div>

              <label>
                Краткое описание
                <input name="summary" maxLength={400} defaultValue={editing?.summary || ""} placeholder="Коротко объясните, для чего этот материал" />
              </label>

              <label>
                Содержание
                <textarea name="body" required defaultValue={editing?.body} placeholder="Инструкция, регламент или решение…" />
              </label>

              <label className="kb-file-picker">
                <span>Документы и файлы</span>
                <input
                  name="attachments"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.png,.jpg,.jpeg,.webp"
                />
                <small>До 10 файлов за одну загрузку, максимум 15 МБ на файл. PDF, Word, Excel, PowerPoint, TXT, ZIP и изображения.</small>
              </label>

              {editing && editing.attachments.length > 0 && (
                <div className="kb-editor-files">
                  <strong>Уже прикреплено</strong>
                  {editing.attachments.map((attachment) => (
                    <div className="kb-editor-file" key={attachment.id}>
                      <a href={`/api/knowledge/files/${attachment.id}`}>{attachment.filename}</a>
                      <span>{fileSize(attachment.size)}</span>
                      <button type="button" className="btn btn-compact btn-danger" onClick={() => removeAttachment(editing.id, attachment.id)}>Удалить</button>
                    </div>
                  ))}
                </div>
              )}

              <label className="checkbox-row kb-pin-control">
                <input type="checkbox" name="isPinned" defaultChecked={editing?.isPinned} />
                Закрепить материал в начале списка
              </label>

              <div className="kb-editor-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setShowForm(false)}>Отмена</button>
                <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить материал"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="kb-workspace">
        <aside className="kb-library" aria-label="Список материалов">
          {loading && <div className="kb-list-state">Обновляем материалы…</div>}
          {!loading && articles.length === 0 && (
            <div className="kb-list-state">
              <strong>Ничего не найдено</strong>
              <span>Измените поиск или выберите другую категорию.</span>
            </div>
          )}
          {articles.map((article) => (
            <button
              key={article.id}
              type="button"
              className={`kb-library-item ${active?.id === article.id ? "active" : ""}`}
              onClick={() => setActive(article)}
            >
              <span className="kb-library-title">{article.isPinned && <b title="Закреплено">★</b>}{article.title}</span>
              <span className="kb-library-meta"><i />{article.category}<em>·</em>{formatDate(article.updatedAt)}</span>
              {article.attachments.length > 0 && <span className="kb-library-files">📎 {article.attachments.length}</span>}
            </button>
          ))}
        </aside>

        <article className="card kb-reader">
          {!active ? (
            <div className="kb-reader-empty">
              <strong>Выберите материал</strong>
              <p className="muted">Содержимое выбранной инструкции появится здесь.</p>
            </div>
          ) : (
            <>
              <div className="kb-reader-head">
                <div>
                  <div className="kb-reader-title-row">
                    {active.isPinned && <span className="kb-pinned-star">★</span>}
                    <h2>{active.title}</h2>
                  </div>
                  <div className="kb-reader-meta">
                    <span className="badge">{active.category}</span>
                    {active.author && <span>автор: {active.author.name}</span>}
                    <span>обновлено {formatDate(active.updatedAt)}</span>
                  </div>
                </div>

                {isAdmin && (
                  <div className="kb-reader-actions">
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => {
                        setEditing(active);
                        setShowForm(true);
                        setError("");
                      }}
                    >
                      Изменить
                    </button>
                    <button className="btn btn-danger" type="button" onClick={() => remove(active.id)}>Удалить</button>
                  </div>
                )}
              </div>

              <div className="kb-reader-content">
                {active.summary && <p className="kb-summary">{active.summary}</p>}
                <div className="kb-body">{active.body}</div>

                {active.tags.length > 0 && (
                  <div className="kb-tags">
                    {active.tags.map((tag) => <span className="badge" key={tag}>#{tag}</span>)}
                  </div>
                )}

                {active.attachments.length > 0 && (
                  <div className="kb-attachments">
                    <h3>Прикреплённые файлы</h3>
                    <div className="kb-attachment-grid">
                      {active.attachments.map((attachment) => (
                        <a className="kb-attachment-card" href={`/api/knowledge/files/${attachment.id}`} key={attachment.id}>
                          <span className="kb-attachment-icon">↧</span>
                          <span className="kb-attachment-info">
                            <strong>{attachment.filename}</strong>
                            <small>{fileSize(attachment.size)}</small>
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
