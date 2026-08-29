"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type FeedItem = {
  id: string;
  number: number;
  title: string;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_RESPONSE" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  lastActivityAt: string;
};

type FeedResponse = { authenticated: boolean; staff: boolean; items: FeedItem[] };

const statusText: Record<FeedItem["status"], string> = {
  OPEN: "Новая",
  IN_PROGRESS: "В работе",
  WAITING_RESPONSE: "Ждёт ответа",
  RESOLVED: "Решена",
  CLOSED: "Закрыта",
};

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "только что";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function HomeFeed() {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [connected, setConnected] = useState(true);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const previousRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function load() {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/home-feed", { cache: "no-store" });
        if (!res.ok) throw new Error("feed");
        const next = await res.json() as FeedResponse;
        if (cancelled) return;
        const nextKeys = new Map(next.items.map((item) => [item.id, `${item.status}:${item.lastActivityAt}`]));
        const changedIds = new Set<string>();
        for (const [id, key] of nextKeys) if (previousRef.current.get(id) !== key) changedIds.add(id);
        previousRef.current = nextKeys;
        setData(next);
        setConnected(true);
        setChanged(changedIds);
        window.setTimeout(() => { if (!cancelled) setChanged(new Set()); }, 900);
      } catch {
        if (!cancelled) setConnected(false);
      }
    }

    load();
    timer = window.setInterval(load, 4000);
    const visibility = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  return (
    <div className="home-live-feed">
      <div className="home-live-feed-head">
        <div><span className={`home-live-dot ${connected ? "on" : "off"}`} />Лента обращений · realtime</div>
        <small>{connected ? "обновляется автоматически" : "переподключение…"}</small>
      </div>
      <div className="home-live-list">
        {!data && <div className="home-live-empty">Загрузка обращений…</div>}
        {data?.items.length === 0 && <div className="home-live-empty">Заявок пока нет.</div>}
        {data?.items.map((item) => {
          const content = (
            <>
              <span className="home-live-id">X-{item.number}</span>
              <strong>{item.title}</strong>
              <span className={`home-live-status status-${item.status.toLowerCase()}`}>{statusText[item.status]}</span>
              <time>{relativeTime(item.lastActivityAt)}</time>
            </>
          );
          return data.authenticated ? (
            <Link key={item.id} href={`/tickets/${item.id}`} className={`home-live-row ${changed.has(item.id) ? "changed" : ""}`}>{content}</Link>
          ) : (
            <div key={item.id} className={`home-live-row ${changed.has(item.id) ? "changed" : ""}`}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
