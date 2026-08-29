"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Keep the one-time reset token out of the visible URL/browser history once
    // the client has received it. The token remains only in component memory.
    if (token && window.location.search) window.history.replaceState(null, "", "/reset-password");
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;
    const fd = new FormData(event.currentTarget);
    const password = String(fd.get("password") || "");
    const repeat = String(fd.get("repeat") || "");
    if (password !== repeat) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось изменить пароль");
        return;
      }
      setDone(true);
    } catch {
      setError("Сервер временно недоступен");
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <div className="error">В ссылке отсутствует код восстановления.</div>;
  if (done) {
    return (
      <div className="stack">
        <div className="success">Пароль изменён. Теперь можно войти с новым паролем.</div>
        <Link href="/" className="btn btn-primary">Вернуться к входу</Link>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>Новый пароль<input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" /></label>
      <label>Повторите пароль<input name="repeat" type="password" required minLength={8} maxLength={72} autoComplete="new-password" /></label>
      {error && <div className="error">{error}</div>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить новый пароль"}</button>
    </form>
  );
}
