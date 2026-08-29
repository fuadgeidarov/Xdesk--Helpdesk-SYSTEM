'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TicketDeleteButton({ ticketId, compact = false }: { ticketId: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function removeTicket() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось удалить заявку");
        setBusy(false);
        return;
      }
      setOpen(false);
      router.push("/tickets");
      router.refresh();
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`btn btn-danger ${compact ? "btn-compact" : ""}`}
        onClick={() => { setError(""); setOpen(true); }}
      >
        🗑 Удалить
      </button>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
          <div className="modal-card ticket-delete-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-delete-title">
            <div className="modal-card-head">
              <div>
                <h3 id="ticket-delete-title">Удалить заявку?</h3>
                <p>Заявка и вся её переписка будут удалены без возможности восстановления.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} disabled={busy} aria-label="Закрыть">×</button>
            </div>
            {error && <div className="error" style={{ marginTop: ".85rem" }}>{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Отмена</button>
              <button type="button" className="btn btn-danger" onClick={removeTicket} disabled={busy}>{busy ? "Удаление…" : "Да, удалить заявку"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function TicketTakeButton({ ticketId, userId }: { ticketId: string; userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function take() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS", assigneeId: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось взять заявку");
        return;
      }
      router.refresh();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ticket-take-wrap">
      <button type="button" className="btn btn-compact btn-secondary" onClick={take} disabled={busy}>
        {busy ? "…" : "+ Взять"}
      </button>
      {error && <small className="ticket-inline-error">{error}</small>}
    </span>
  );
}
