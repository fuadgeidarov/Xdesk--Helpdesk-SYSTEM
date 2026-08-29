"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { stores } from "@/lib/stores";

type Mode = "login" | "register";

type AuthenticatedUser = { name: string; email: string; role: "USER" | "AGENT" | "ADMIN" };

export function LandingAuthCard({ user = null }: { user?: AuthenticatedUser | null }) {
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotMessage, setForgotMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const fd = new FormData(event.currentTarget);
    const payload = mode === "login"
      ? { email: String(fd.get("email") || ""), password: String(fd.get("password") || "") }
      : {
          name: String(fd.get("name") || ""),
          email: String(fd.get("email") || ""),
          password: String(fd.get("password") || ""),
          department: String(fd.get("department") || ""),
          phone: String(fd.get("phone") || ""),
          store: String(fd.get("store") || ""),
        };
    try {
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось выполнить операцию");
        return;
      }
      window.location.href = "/tickets";
    } catch {
      setError("Сервер временно недоступен");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setForgotMessage("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось отправить письмо");
        return;
      }
      setForgotMessage(data.message || "Проверьте почту");
    } catch {
      setError("Сервер временно недоступен");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    const roleLabel = user.role === "ADMIN" ? "Администратор" : user.role === "AGENT" ? "Агент поддержки" : "Пользователь";
    return (
      <div className="landing-auth-card card landing-session-card">
        <div className="landing-session-copy">
          <span className="pill">Вы вошли в систему</span>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <strong>{roleLabel}</strong>
        </div>
        <Link href="/tickets" className="btn btn-primary">{user.role === "USER" ? "Открыть мои заявки" : "Открыть очередь заявок"}</Link>
        <Link href="/profile" className="btn btn-secondary">Профиль</Link>
      </div>
    );
  }

  return (
    <div className="landing-auth-card card">
      <div className="landing-auth-tabs" role="tablist" aria-label="Авторизация">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Вход</button>
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>Регистрация</button>
      </div>
      {forgotOpen ? (
        <form className="form landing-auth-form" onSubmit={requestPasswordReset}>
          <div className="landing-forgot-copy"><strong>Восстановление пароля</strong><span>Укажите e-mail вашей учётной записи. Мы отправим одноразовую ссылку для задания нового пароля.</span></div>
          <label>E-mail<input type="email" required value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} placeholder="you@company.ru" autoComplete="email" /></label>
          {error && <div className="error">{error}</div>}
          {forgotMessage && <div className="success">{forgotMessage}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Отправляем…" : "Отправить ссылку"}</button>
          <button className="landing-forgot-back" type="button" onClick={() => { setForgotOpen(false); setError(""); setForgotMessage(""); }}>← Вернуться ко входу</button>
        </form>
      ) : (
      <form className="form landing-auth-form" onSubmit={submit}>
        {mode === "register" && (
          <label>ФИО<input name="name" required minLength={2} maxLength={80} placeholder="Иван Иванов" /></label>
        )}
        <label>E-mail<input name="email" type="email" required placeholder="you@company.ru" /></label>
        <label>Пароль<input name="password" type="password" required minLength={mode === "register" ? 8 : 1} maxLength={mode === "register" ? 72 : 128} placeholder="••••••" /></label>
        {mode === "register" && (
          <>
            <label>Магазин<select name="store" required defaultValue=""><option value="" disabled>Выберите магазин</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
            <div className="grid grid-2 landing-auth-extra">
              <label>Отдел<input name="department" maxLength={80} placeholder="Отдел" /></label>
              <label>Телефон<input name="phone" maxLength={40} placeholder="Телефон" /></label>
            </div>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Подождите…" : mode === "login" ? "Войти в портал" : "Зарегистрироваться"}</button>
        {mode === "login" && <button className="landing-forgot-link" type="button" onClick={() => { setForgotOpen(true); setForgotEmail(""); setForgotMessage(""); setError(""); }}>Забыли пароль?</button>}
      </form>
      )}
      <div className="landing-auth-divider"><span>или</span></div>
      <Link href="/tickets/new" className="landing-guest-link"><strong>Создать заявку без регистрации</strong><span>Достаточно имени, телефон — по желанию</span></Link>
    </div>
  );
}
