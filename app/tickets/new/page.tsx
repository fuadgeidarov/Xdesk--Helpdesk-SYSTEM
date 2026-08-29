'use client';

import { FormEvent, useEffect, useState } from "react";
import { categories } from "@/lib/labels";
import { stores } from "@/lib/stores";

export default function NewTicketPage() {
  const [me, setMe] = useState<{ id: string; name: string; email: string; store?: string | null } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [guestCreated, setGuestCreated] = useState<{ number: number } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    if (me) {
      fd.delete("guestName");
      fd.delete("guestPhone");
    }

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        body: fd,
      });
      setLoading(false);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось создать заявку");
        return;
      }
      if (me) {
        window.location.href = `/tickets/${data.id}`;
      } else {
        setGuestCreated({ number: data.number });
      }
    } catch (err) {
      setLoading(false);
      setError("Ошибка сети или сервера");
    }
  }

  if (guestCreated) {
    return (
      <section className="section" style={{ paddingTop: "1.5rem" }}>
        <div className="card" style={{ maxWidth: 720 }}>
          <h2>Заявка X-{guestCreated.number} принята</h2>
          <p className="muted">Обращение сохранено. IT-поддержка увидит заявку и возьмёт её в работу.</p>
          <div className="actions">
            <a className="btn btn-primary" href="/">На главную</a>
            <a className="btn btn-secondary" href="/login">Войти в систему</a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section" style={{ paddingTop: "1.5rem" }}>
      <div className="section-head">
        <div>
          <h2>Новое обращение</h2>
          <p>Подайте заявку в поддержку — IT специалист оперативно решит проблему</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <form className="form" onSubmit={onSubmit}>
          {error && <div className="error">{error}</div>}

          {!me && (
            <div className="grid grid-2">
              <label>
                Ваше имя *
                <input name="guestName" required placeholder="Иван Иванов" />
              </label>
              <label>
                Телефон (необязательно)
                <input name="guestPhone" type="tel" inputMode="tel" maxLength={40} placeholder="+7 700 000 00 00" autoComplete="tel" />
              </label>
            </div>
          )}

          <label>
            Тема обращения *
            <input name="title" required maxLength={140} placeholder="Не работает принтер / нет доступа к папке" />
          </label>

          <div className="grid grid-2">
            <label>
            Магазин *
            <select name="store" required defaultValue={me?.store || ""}>
              <option value="" disabled>Выберите магазин</option>
              {stores.map((store) => <option key={store} value={store}>{store}</option>)}
            </select>
          </label>
          <label>
            Категория
            <select name="category" defaultValue="Общее">
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            </label>
          </div>

          <label>
            Приоритет
            <select name="priority" defaultValue="MEDIUM">
              <option value="LOW">Низкий</option>
              <option value="MEDIUM">Средний</option>
              <option value="HIGH">Высокий</option>
              <option value="CRITICAL">Критичный</option>
            </select>
          </label>

          <label>
            Сообщение *
            <textarea
              name="description"
              required
              placeholder="Подробно опишите, что случилось, какой кабинет/компьютер..."
            />
          </label>

          <label>
            Вложения (необязательно)
            <input
              name="files"
              type="file"
              multiple
              onChange={(e) => setFileNames(Array.from(e.target.files || []).map((file) => file.name))}
            />
            {fileNames.length > 0 && <span className="muted" style={{ fontSize: "0.85rem" }}>Выбрано файлов: {fileNames.length}</span>}
          </label>

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Отправка..." : "Отправить обращение"}
          </button>
        </form>
      </div>
    </section>
  );
}
