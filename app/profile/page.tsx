"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { roleLabels } from "@/lib/labels";
import { stores } from "@/lib/stores";

type Profile = {
  id: string;
  email: string;
  name: string;
  department: string | null;
  position: string | null;
  phone: string | null;
  address: string | null;
  store: string | null;
  avatarUpdatedAt: string | null;
  role: keyof typeof roleLabels;
  createdAt: string;
};

export default function ProfilePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) {
          router.push("/login");
          return;
        }
        const data: Profile = await res.json();
        setProfile(data);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  const initials = useMemo(() => (profile?.name || "U").trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase(), [profile?.name]);

  function onAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function removeAvatar() {
    if (!profile?.avatarUpdatedAt && !avatarPreview) return;
    setAvatarLoading(true);
    setError("");
    const res = await fetch("/api/profile/avatar", { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось удалить фото");
      setAvatarLoading(false);
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview("");
    if (fileRef.current) fileRef.current.value = "";
    setProfile((current) => current ? { ...current, avatarUpdatedAt: null } : current);
    setMessage("Фото профиля удалено");
    setAvatarLoading(false);
    router.refresh();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    setError("");
    setMessage("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") || "");
    const currentPassword = String(fd.get("currentPassword") || "");
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        email: fd.get("email"),
        department: fd.get("department") || null,
        position: fd.get("position") || null,
        phone: fd.get("phone") || null,
        address: fd.get("address") || null,
        store: fd.get("store") || null,
        currentPassword: currentPassword || undefined,
        password: password || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось сохранить");
      setLoading(false);
      return;
    }
    const updated: Profile = await res.json();
    const avatar = fd.get("avatar");
    if (avatar instanceof File && avatar.size > 0) {
      const avatarData = new FormData();
      avatarData.set("avatar", avatar);
      const avatarRes = await fetch("/api/profile/avatar", { method: "POST", body: avatarData });
      if (!avatarRes.ok) {
        const data = await avatarRes.json().catch(() => ({}));
        setError(data.error || "Данные профиля сохранены, но фото загрузить не удалось");
        setProfile(updated);
        setLoading(false);
        return;
      }
      const avatarUpdated = await avatarRes.json();
      updated.avatarUpdatedAt = avatarUpdated.avatarUpdatedAt;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview("");
    setProfile(updated);
    setMessage("Изменения сохранены");
    setLoading(false);
    router.refresh();
  }

  if (!profile) {
    return <div className="section"><div className="profile-loading"><span className="spinner" />Загрузка профиля...</div></div>;
  }

  const avatarSrc = avatarPreview || (profile.avatarUpdatedAt ? `/api/profile/avatar?v=${encodeURIComponent(profile.avatarUpdatedAt)}` : "");

  return (
    <section className="section profile-section">
      <div className="profile-heading">
        <div>
          <span className="eyebrow">Личные настройки</span>
          <h2>Профиль</h2>
          <p>Управляйте контактами и данными, которые видят коллеги в Xdesk.</p>
        </div>
        <div className="profile-status"><span className="profile-status-dot" />Профиль активен</div>
      </div>

      <div className="profile-modern-grid">
        <aside className="profile-card profile-overview">
          <div className="profile-cover" />
          <div className="profile-overview-body">
            <div className="profile-avatar-wrap">
              <div className="avatar profile-avatar profile-avatar-lg">
                {avatarSrc ? <img src={avatarSrc} alt={`Фото ${profile.name}`} /> : initials}
              </div>
              <button type="button" className="avatar-edit" onClick={() => fileRef.current?.click()} aria-label="Изменить фото">✎</button>
            </div>
            <h3>{profile.name}</h3>
            <p className="profile-position">{profile.position || roleLabels[profile.role]}</p>
            <div className="profile-badges"><span className="badge">{roleLabels[profile.role]}</span>{profile.department && <span className="badge badge-soft">{profile.department}</span>}{profile.store && <span className="badge badge-soft">{profile.store}</span>}</div>

            <div className="profile-contact-list">
              <div><span>✉</span><div><small>E-mail</small><strong>{profile.email}</strong></div></div>
              <div><span>☎</span><div><small>Телефон</small><strong>{profile.phone || "Не указан"}</strong></div></div>
              <div><span>⌖</span><div><small>Адрес</small><strong>{profile.address || "Не указан"}</strong></div></div>
              <div><span>▣</span><div><small>Магазин</small><strong>{profile.store || "Не указан"}</strong></div></div>
            </div>

            <div className="profile-member-since">В системе с {new Date(profile.createdAt).toLocaleDateString("ru-RU")}</div>
          </div>
        </aside>

        <div className="profile-card profile-editor">
          <form className="form profile-form" onSubmit={onSubmit}>
            {error && <div className="error">{error}</div>}
            {message && <div className="success">{message}</div>}

            <div className="profile-form-section">
              <div className="profile-form-title"><span>01</span><div><h3>Основная информация</h3><p>Как вас будут видеть в системе.</p></div></div>
              <div className="profile-form-grid">
                <label>Имя и фамилия<input name="name" defaultValue={profile.name} required autoComplete="name" /></label>
                <label>E-mail<input name="email" type="email" defaultValue={profile.email} required autoComplete="email" /></label>
                <label>Должность<input name="position" defaultValue={profile.position || ""} placeholder="Например: Системный администратор" /></label>
                <label>Отдел<input name="department" defaultValue={profile.department || ""} placeholder="Например: IT" /></label>
                <label>Магазин<select name="store" defaultValue={profile.store || ""} required><option value="">Выберите магазин</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
              </div>
            </div>

            <div className="profile-form-section">
              <div className="profile-form-title"><span>02</span><div><h3>Контакты</h3><p>Контактные данные для коллег.</p></div></div>
              <div className="profile-form-grid">
                <label>Телефон<input name="phone" type="tel" defaultValue={profile.phone || ""} placeholder="+7 (___) ___-__-__" autoComplete="tel" /></label>
                <label className="full-span">Рабочий адрес<textarea name="address" defaultValue={profile.address || ""} rows={3} placeholder="Город, улица, кабинет" autoComplete="street-address" /></label>
              </div>
            </div>

            <div className="profile-form-section">
              <div className="profile-form-title"><span>03</span><div><h3>Фото профиля</h3><p>PNG, JPG, GIF или WebP — не более 5 МБ.</p></div></div>
              <div className="avatar-upload-row">
                <div className="avatar profile-avatar upload-avatar">{avatarSrc ? <img src={avatarSrc} alt="Предпросмотр фото" /> : initials}</div>
                <div className="avatar-upload-content">
                  <strong>{profile.avatarUpdatedAt ? "Фото установлено" : "Добавьте фото"}</strong>
                  <span>Хорошее фото помогает коллегам быстрее вас узнать.</span>
                  <div className="avatar-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>{avatarSrc ? "Заменить фото" : "Выбрать фото"}</button>
                    {(profile.avatarUpdatedAt || avatarPreview) && <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={removeAvatar} disabled={avatarLoading}>{avatarLoading ? "Удаляем..." : "Удалить фото"}</button>}
                  </div>
                </div>
                <input ref={fileRef} name="avatar" className="profile-file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onAvatarChange} />
              </div>
            </div>

            <div className="profile-form-section profile-security">
              <div className="profile-form-title"><span>04</span><div><h3>Безопасность</h3><p>Текущий пароль нужен только при смене e-mail или пароля.</p></div></div>
              <label>Текущий пароль<input name="currentPassword" type="password" maxLength={128} autoComplete="current-password" /></label>
              <label>Новый пароль<input name="password" type="password" minLength={8} maxLength={72} placeholder="Минимум 8 символов" autoComplete="new-password" /></label>
            </div>

            <div className="profile-save-row">
              <span className="muted">Изменения применяются сразу после сохранения.</span>
              <button className="btn btn-primary profile-save-btn" type="submit" disabled={loading}>{loading ? "Сохраняем..." : "Сохранить изменения"}</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
