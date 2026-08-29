"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "./Logo";

type Props = {
  user: { id: string; name: string; email: string; role: "USER" | "AGENT" | "ADMIN"; avatarUpdatedAt?: string | null } | null;
};

type Presence = "ONLINE" | "AWAY" | "OFFLINE";

const presenceLabels: Record<Presence, string> = {
  ONLINE: "Онлайн",
  AWAY: "Нет на месте",
  OFFLINE: "Офлайн",
};

const pageTitles: Array<[RegExp, string]> = [
  [/^\/tickets(?:\/|$)/, "Очередь заявок"],
  [/^\/knowledge(?:\/|$)/, "База знаний"],
  [/^\/analytics(?:\/|$)/, "Аналитика"],
  [/^\/admin(?:\/|$)/, "Пользователи"],
  [/^\/profile(?:\/|$)/, "Профиль"],
];

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";
}

export function Header({ user }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [presence, setPresence] = useState<Presence>("OFFLINE");
  const [presenceBusy, setPresenceBusy] = useState(false);

  const staff = user?.role === "AGENT" || user?.role === "ADMIN";
  const avatarSrc = user?.avatarUpdatedAt
    ? `/api/profile/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`
    : "";
  const title = useMemo(() => {
    if (pathname.startsWith("/tickets") && user?.role === "USER") return "Мои заявки";
    return pageTitles.find(([pattern]) => pattern.test(pathname))?.[1] || "Xdesk";
  }, [pathname, user?.role]);

  useEffect(() => {
    if (!staff) return;
    let cancelled = false;
    fetch("/api/presence", { cache: "no-store" })
      .then(async (res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data?.status) setPresence(data.status as Presence);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [staff]);

  async function changePresence(next: Presence) {
    if (!staff || presenceBusy) return;
    const previous = presence;
    setPresence(next);
    setPresenceBusy(true);
    try {
      const res = await fetch("/api/presence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) setPresence(previous);
    } catch {
      setPresence(previous);
    } finally {
      setPresenceBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
    router.refresh();
  }

  if (!user) {
    return (
      <header className="topbar topbar-public">
        <Logo />
      </header>
    );
  }

  const links = user.role === "USER"
    ? [
        ["/tickets", "Мои заявки", "▣"],
        ["/knowledge", "База знаний", "▥"],
      ] as const
    : [
        ["/tickets", "Очередь заявок", "▣"],
        ["/knowledge", "База знаний", "▥"],
        ["/analytics", "Аналитика", "ϟ"],
        ["/admin", "Пользователи", "♙"],
      ] as const;

  return (
    <>
      <aside className={`portal-sidebar ${open ? "is-open" : ""}`}>
        <div className="portal-sidebar-brand"><Logo withTagline withCompany /></div>
        <nav className="portal-nav" aria-label="Основное меню">
          {links.map(([href, label, icon]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className={pathname === href || pathname.startsWith(`${href}/`) ? "active" : undefined}>
              <span className="portal-nav-icon" aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="portal-sidebar-foot">
          <span className="portal-role-note">{user.role === "ADMIN" ? "Администратор" : user.role === "AGENT" ? "Агент поддержки" : "Пользователь"}</span>
        </div>
      </aside>

      <header className="portal-topbar">
        <div className="portal-topbar-left">
          <button type="button" className="portal-menu-toggle" aria-label="Открыть меню" onClick={() => setOpen((value) => !value)}>☰</button>
          {staff && (
            <label className={`presence-picker presence-${presence.toLowerCase()}`}>
              <span className="presence-dot" />
              <select value={presence} disabled={presenceBusy} onChange={(event) => changePresence(event.target.value as Presence)} aria-label="Рабочий статус">
                <option value="ONLINE">Онлайн</option>
                <option value="AWAY">Нет на месте</option>
                <option value="OFFLINE">Офлайн</option>
              </select>
            </label>
          )}
          <div className="portal-page-caption">
            <strong>{title}</strong>
            <span>{staff ? "ПАНЕЛЬ IT-ПОДДЕРЖКИ" : "ПОРТАЛ IT-ПОДДЕРЖКИ"}</span>
          </div>
        </div>
        <div className="portal-account">
          <Link href="/profile" className="portal-account-link" title="Открыть профиль">
            <span className="portal-account-avatar">{avatarSrc ? <img src={avatarSrc} alt={`Фото ${user.name}`} /> : initials(user.name)}</span>
            <span className="portal-account-copy"><strong>{user.name}</strong><small>{user.email}</small></span>
            <span className={`portal-account-role role-${user.role.toLowerCase()}`}>{user.role === "ADMIN" ? "Администратор" : user.role === "AGENT" ? "Агент поддержки" : "Пользователь"}</span>
          </Link>
          <button type="button" className="portal-logout" onClick={logout} aria-label="Выйти" title="Выйти">↪</button>
        </div>
      </header>
      {open && <button className="portal-sidebar-scrim" type="button" aria-label="Закрыть меню" onClick={() => setOpen(false)} />}
    </>
  );
}
