"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "./ui/button";
import type { cancellationView } from "@/lib/cancellation";
export function CancellationForm({ view, enabled }: { view: Awaited<ReturnType<typeof cancellationView>>; enabled: boolean }) {
  const router = useRouter(), hydrated = useHydrated();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <form method="post" className="space-y-4 rounded border border-border p-6" onSubmit={async event => {
    event.preventDefault(); const form = event.currentTarget, f = new FormData(form); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/participations/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId: view.editionId, participationId: view.participationId, revision: view.revision, confirmed: f.get("confirmed") === "on", ...(view.chief ? { reason: f.get("reason"), password: f.get("password") } : {}) }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error || "Не удалось отменить участие"); return; }
      router.push(view.chief ? "/cabinet/registrations" : "/cabinet/olympiad"); router.refresh();
    } catch { setMessage("Не удалось получить ответ. Обновите страницу перед повтором."); }
    finally { setBusy(false); const input = form.elements.namedItem("password") as HTMLInputElement | null; if (input) input.value = ""; }
  }}>
    <p>{view.fullName} · СМО {view.year}</p><p>Отменится только эта заявка. Аккаунт и история сохранятся, место в команде освободится. Восстановления не будет.</p>
    {view.dissolvedTeamName && <p className="font-semibold">Участник — капитан команды {view.dissolvedTeamName}. Команда удалится целиком. Остальные участники сохранят свои заявки и смогут вступить в другую команду до закрытия.</p>}
    {view.chief && <><label className="block">Причина отмены (без ПДн и секретов)<textarea name="reason" required maxLength={1000} className="block w-full rounded border p-2" /></label><label className="block">Текущий пароль<input type="password" name="password" autoComplete="current-password" required maxLength={128} className="block w-full rounded border p-2" /></label></>}
    <label className="flex gap-3"><input type="checkbox" name="confirmed" required />Я понимаю, что восстановить участие нельзя</label>
    <Button disabled={busy || !enabled || !hydrated}>Отменить участие</Button>{message && <p role="alert">{message}</p>}
  </form>;
}
