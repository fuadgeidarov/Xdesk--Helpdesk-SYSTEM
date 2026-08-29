"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { stores } from "@/lib/stores";

const userRoleLabels = {
  USER: "Пользователь",
  AGENT: "Агент поддержки",
  ADMIN: "Администратор",
} as const;

type Role = keyof typeof userRoleLabels;

type UserRow = {
  id: string;
  email: string;
  name: string;
  department: string | null;
  position: string | null;
  store: string | null;
  role: Role;
  isBlocked: boolean;
  lastSeenAt: string | null;
  presenceStatus: "ONLINE" | "AWAY" | "OFFLINE";
  createdAt: string;
  rating: { average: number | null; count: number };
  _count: {
    ticketsCreated: number;
    ticketsAssigned: number;
    comments: number;
    ratingsGiven: number;
    ratingsReceived: number;
    articles: number;
  };
};

type Me = { id: string; role: Role; name: string; email: string };

type UserForm = {
  name: string;
  email: string;
  password: string;
  role: Role;
  department: string;
  position: string;
  store: string;
};

const emptyForm: UserForm = {
  name: "",
  email: "",
  password: "",
  role: "USER",
  department: "",
  position: "",
  store: "",
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function presence(user: UserRow) {
  if (user.isBlocked) return { label: "Заблокирован", tone: "blocked" };
  if (user.role !== "AGENT" && user.role !== "ADMIN") return { label: "Активен", tone: "online" };
  if (user.presenceStatus === "ONLINE") return { label: "Онлайн", tone: "online" };
  if (user.presenceStatus === "AWAY") return { label: "Нет на месте", tone: "away" };
  return { label: "Офлайн", tone: "offline" };
}

export default function UsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | Role>("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const isAdmin = me?.role === "ADMIN";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        if (!meRes.ok) {
          router.replace("/login");
          return;
        }
        const current = (await meRes.json()) as Me;
        if (current.role !== "ADMIN" && current.role !== "AGENT") {
          router.replace("/tickets");
          return;
        }
        if (cancelled) return;
        setMe(current);
        await loadUsers();
      } catch {
        if (!cancelled) setError("Не удалось открыть список пользователей");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!formOpen && !deleteTarget) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!saving) closeForm();
      if (!deleting) setDeleteTarget(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [formOpen, deleteTarget, saving, deleting]);

  async function loadUsers() {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Не удалось загрузить пользователей");
    }
    setUsers(await res.json());
  }

  const counts = useMemo(() => ({
    ALL: users.length,
    ADMIN: users.filter((item) => item.role === "ADMIN").length,
    AGENT: users.filter((item) => item.role === "AGENT").length,
    USER: users.filter((item) => item.role === "USER").length,
  }), [users]);

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return users.filter((item) => {
      if (roleFilter !== "ALL" && item.role !== roleFilter) return false;
      if (!needle) return true;
      return [item.name, item.email, item.position, item.department, item.store]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("ru").includes(needle));
    });
  }, [users, query, roleFilter]);

  function openCreate() {
    if (!isAdmin) return;
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(user: UserRow) {
    if (!isAdmin) return;
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      department: user.department || "",
      position: user.position || "",
      store: user.store || "",
    });
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setFormError("");
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    setFormError("");
    try {
      const editMode = Boolean(editing);
      const res = await fetch("/api/admin/users", {
        method: editMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editMode
          ? { action: "update", userId: editing!.id, ...form, password: form.password || undefined }
          : form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || "Не удалось сохранить пользователя");
        return;
      }
      await loadUsers();
      setFormOpen(false);
      setEditing(null);
      setFormError("");
    } catch {
      setFormError("Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  function canChangePassword(user: UserRow) {
    if (!me) return false;
    if (me.role === "ADMIN") return true;
    return me.role === "AGENT" && user.role === "USER";
  }

  function openPasswordChange(user: UserRow) {
    if (!canChangePassword(user)) return;
    setPasswordTarget(user);
    setNewPassword("");
    setPasswordError("");
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordTarget || !canChangePassword(passwordTarget)) return;
    setPasswordSaving(true);
    setPasswordError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "password", userId: passwordTarget.id, password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPasswordError(data.error || "Не удалось изменить пароль"); return; }
      setPasswordTarget(null);
      setNewPassword("");
      alert("Пароль изменён. Активные сеансы пользователя завершены.");
    } catch { setPasswordError("Ошибка сети"); }
    finally { setPasswordSaving(false); }
  }

  async function toggleBlock(user: UserRow) {
    if (!me || user.id === me.id) return;
    setBlockingId(user.id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "block", userId: user.id, blocked: !user.isBlocked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Не удалось изменить состояние пользователя");
        return;
      }
      await loadUsers();
    } catch {
      alert("Ошибка сети");
    } finally {
      setBlockingId(null);
    }
  }

  function canBlock(user: UserRow) {
    if (!me || user.id === me.id || user.role === "ADMIN") return false;
    return me.role === "ADMIN" || (me.role === "AGENT" && user.role === "USER");
  }

  async function deleteUser() {
    if (!isAdmin || !deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/admin/users?userId=${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error || "Не удалось удалить пользователя");
        return;
      }
      setDeleteTarget(null);
      await loadUsers();
    } catch {
      setDeleteError("Ошибка сети");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <section className="section users-directory"><p className="muted">Загрузка пользователей...</p></section>;
  }

  return (
    <section className="section users-directory">
      <div className="users-directory-head">
        <div>
          <h2>Пользователи</h2>
          <p>{users.length} учётных записей · управление доступом и ролями</p>
        </div>
        <div className="users-head-actions">
          <label className="users-search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Имя или e-mail..." />
          </label>
          {isAdmin && <button type="button" className="btn btn-primary" onClick={openCreate}>＋ Добавить</button>}
        </div>
      </div>

      <div className="users-role-tabs" role="tablist" aria-label="Фильтр по роли">
        {([
          ["ALL", "Все", counts.ALL],
          ["ADMIN", "Администраторы", counts.ADMIN],
          ["AGENT", "Агенты поддержки", counts.AGENT],
          ["USER", "Пользователи", counts.USER],
        ] as const).map(([value, label, count]) => (
          <button key={value} type="button" className={roleFilter === value ? "active" : ""} onClick={() => setRoleFilter(value)}>
            {label} · {count}
          </button>
        ))}
      </div>

      {error && <div className="error" style={{ marginBottom: "1rem" }}>{error}</div>}

      <div className="users-table-card">
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Магазин</th>
                <th>Должность</th>
                <th>Активные</th>
                <th>Рейтинг</th>
                <th>В системе с</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => {
                const state = presence(user);
                return (
                  <tr key={user.id} className={user.isBlocked ? "is-blocked" : ""}>
                    <td>
                      <div className="directory-person">
                        <span className={`directory-avatar role-${user.role.toLowerCase()}`}>{initials(user.name)}</span>
                        <div>
                          <strong>{user.name}</strong>
                          <span>{user.email}{user.department ? ` · ${user.department}` : ""}</span>
                        </div>
                      </div>
                    </td>
                    <td><span className={`directory-role role-${user.role.toLowerCase()}`}>{userRoleLabels[user.role]}</span></td>
                    <td><span className={`directory-presence ${state.tone}`}><i />{state.label}</span></td>
                    <td>{user.store || "—"}</td>
                    <td>{user.position || "—"}</td>
                    <td className="users-number">{user.role === "AGENT" || user.role === "ADMIN" ? user._count.ticketsAssigned : "—"}</td>
                    <td>
                      {user.role === "AGENT" || user.role === "ADMIN" ? (
                        user.rating.average == null ? <span className="muted">—</span> : <span className="directory-rating">★★★★★ <b>{user.rating.average.toFixed(1).replace(".", ",")}</b></span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>{shortDate(user.createdAt)}</td>
                    <td>
                      <div className="directory-actions">
                        {isAdmin && <button type="button" className="btn btn-compact btn-secondary" onClick={() => openEdit(user)}>Изменить</button>}
                        {canChangePassword(user) && <button type="button" className="btn btn-compact btn-secondary" onClick={() => openPasswordChange(user)}>Пароль</button>}
                        {canBlock(user) && (
                          <button type="button" className="btn btn-compact btn-warning" disabled={blockingId === user.id} onClick={() => toggleBlock(user)}>
                            {blockingId === user.id ? "..." : user.isBlocked ? "Разблок." : "Блок"}
                          </button>
                        )}
                        {isAdmin && user.id !== me?.id && (
                          <button type="button" className="btn btn-compact btn-danger" onClick={() => { setDeleteError(""); setDeleteTarget(user); }}>Удалить</button>
                        )}
                        {!isAdmin && !canBlock(user) && <span className="muted">Просмотр</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleUsers.length === 0 && <div className="users-empty">Пользователи по заданным условиям не найдены.</div>}
      </div>

      {formOpen && isAdmin && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
          <div className="modal-card user-editor-modal" role="dialog" aria-modal="true" aria-labelledby="user-editor-title">
            <div className="modal-head">
              <div>
                <h3 id="user-editor-title">{editing ? "Редактирование пользователя" : "Новый пользователь"}</h3>
                <p>{editing ? "Изменения применятся сразу после сохранения" : "Учётная запись появится сразу после сохранения"}</p>
              </div>
              <button type="button" className="modal-close" onClick={closeForm} disabled={saving} aria-label="Закрыть">×</button>
            </div>

            <form className="user-editor-form" onSubmit={saveUser}>
              <label className="full">ФИО
                <input required minLength={2} maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Фамилия Имя Отчество" />
              </label>
              <div className="modal-grid-2">
                <label>E-mail
                  <input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="user@company.ru" />
                </label>
                <label>{editing ? "Новый пароль" : "Пароль"}
                  <input type="password" required={!editing} minLength={8} maxLength={72} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editing ? "Оставьте пустым, если не меняете" : "минимум 8 символов"} />
                </label>
                <label>Роль
                  <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
                    <option value="USER">Пользователь</option>
                    <option value="AGENT">Агент поддержки</option>
                    <option value="ADMIN">Администратор</option>
                  </select>
                </label>
                <label>Отдел
                  <input maxLength={80} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="Например: IT" />
                </label>
                <label>Магазин
                  <select required value={form.store} onChange={(event) => setForm({ ...form, store: event.target.value })}>
                    <option value="" disabled>Выберите магазин</option>
                    {stores.map((store) => <option key={store} value={store}>{store}</option>)}
                  </select>
                </label>
                <label>Должность в предприятии
                  <input maxLength={120} value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} placeholder="Например: Инженер" />
                </label>
              </div>

              {formError && <div className="error">{formError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={saving}>Отмена</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Сохраняем..." : "Сохранить"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {passwordTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !passwordSaving) setPasswordTarget(null); }}>
          <div className="modal-card modal-card-sm" role="dialog" aria-modal="true" aria-labelledby="password-change-title">
            <div className="modal-head">
              <div><h3 id="password-change-title">Сменить пароль</h3><p>{passwordTarget.name} · {passwordTarget.email}</p></div>
              <button type="button" className="modal-close" onClick={() => setPasswordTarget(null)} disabled={passwordSaving} aria-label="Закрыть">×</button>
            </div>
            <form className="user-editor-form" onSubmit={changePassword}>
              <label className="full">Новый пароль
                <input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="минимум 8 символов" />
              </label>
              {passwordError && <div className="error">{passwordError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setPasswordTarget(null)} disabled={passwordSaving}>Отмена</button>
                <button type="submit" className="btn btn-primary" disabled={passwordSaving}>{passwordSaving ? "Сохраняем..." : "Изменить пароль"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && isAdmin && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setDeleteTarget(null); }}>
          <div className="modal-card modal-card-sm delete-user-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
            <div className="modal-head">
              <div>
                <h3 id="delete-user-title">Удалить пользователя?</h3>
                <p>Это действие доступно только администратору.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setDeleteTarget(null)} disabled={deleting} aria-label="Закрыть">×</button>
            </div>
            <div className="delete-warning">
              <strong>{deleteTarget.name}</strong>
              <span>{deleteTarget.email}</span>
              <p>Действительно удалить этого пользователя? Учётная запись будет отключена и исчезнет из списка. История заявок, сообщений и оценок останется в системе.</p>
            </div>
            {deleteError && <div className="error">{deleteError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>Отмена</button>
              <button type="button" className="btn btn-danger" onClick={deleteUser} disabled={deleting}>{deleting ? "Удаляем..." : "Да, удалить"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
