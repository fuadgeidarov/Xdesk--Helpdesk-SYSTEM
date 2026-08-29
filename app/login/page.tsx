'use client';

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
        }),
      });
      setLoading(false);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Ошибка входа");
        return;
      }
      window.location.href = "/tickets";
    } catch (err) {
      setLoading(false);
      setError("Ошибка сети или сервера");
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Вход в Xdesk</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Войдите, чтобы работать с тикетами и поддержкой.
        </p>
        <form className="form" onSubmit={onSubmit}>
          {error && <div className="error">{error}</div>}
          <label>
            Email
            <input name="email" type="email" required placeholder="you@company.local" />
          </label>
          <label>
            Пароль
            <input name="password" type="password" required maxLength={128} />
          </label>
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>
          Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}
