'use client';

import Link from "next/link";
import { FormEvent, useState } from "react";
import { stores } from "@/lib/stores";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          email: fd.get("email"),
          password: fd.get("password"),
          department: fd.get("department") || undefined,
          phone: fd.get("phone") || undefined,
          store: fd.get("store") || undefined,
        }),
      });
      setLoading(false);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось зарегистрироваться");
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
        <h1>Регистрация</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Создайте аккаунт сотрудника.
        </p>
        <form className="form" onSubmit={onSubmit}>
          {error && <div className="error">{error}</div>}
          <label>
            ФИО
            <input name="name" required placeholder="Иван Иванов" />
          </label>
          <label>
            Email
            <input name="email" type="email" required placeholder="ivan@company.local" />
          </label>
          <label>
            Пароль
            <input name="password" type="password" minLength={8} maxLength={72} required />
          </label>
          <label>
            Отдел
            <input name="department" placeholder="Бухгалтерия" />
          </label>
          <label>
            Магазин
            <select name="store" required defaultValue="">
              <option value="" disabled>Выберите магазин</option>
              {stores.map((store) => <option key={store} value={store}>{store}</option>)}
            </select>
          </label>
          <label>
            Телефон
            <input name="phone" placeholder="+7..." />
          </label>
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? "Создаём..." : "Зарегистрироваться"}
          </button>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
