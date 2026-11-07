"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import type { profileView } from "@/lib/corrections";
type View = Awaited<ReturnType<typeof profileView>> & { editionId?: string; participationId?: string; chief?: boolean };
const field = "mt-2 block w-full rounded border border-border p-3";
export function ProfileEditor({ view, enabled }: { view: View; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const annual = !!view.participationId;
  return <form className="space-y-4 rounded border border-border bg-white p-6" onSubmit={async event => {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const body = { fullName: data.get("fullName"), universityId: data.get("universityId"), courseId: data.get("courseId"), revision: view.revision,
        ...(annual ? { editionId: view.editionId, participationId: view.participationId } : {}),
        ...(view.chief ? { reason: data.get("reason"), password: data.get("password") } : {}) };
      const response = await fetch(annual ? "/api/participations/correction" : "/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      setMessage(response.ok ? "Изменения сохранены. Заявки других лет не менялись." : result.error || "Не удалось сохранить");
      if (response.ok) router.refresh();
    } catch { setMessage("Не удалось получить ответ. Обновите страницу перед повтором."); }
    finally { setBusy(false); const password = form.elements.namedItem("password") as HTMLInputElement | null; if (password) password.value = ""; }
  }}>
    <p>{annual ? (view.chief ? "Исправляется только выбранная заявка после закрытия приёма. Текущий профиль участника и другие годы не меняются." : "Исправляется выбранная заявка и текущий профиль. Заявки других лет не меняются. После закрытия исправление доступно главному организатору.") : "Это текущий профиль для будущих заявок. Уже поданные заявки содержат отдельные снимки и не изменятся."}</p>
    <p>Email, роль и площадка здесь не меняются. Используйте только вымышленные данные.</p>
    <label className="block">ФИО<input className={field} name="fullName" defaultValue={view.fullName} required minLength={3} maxLength={200} /></label>
    <label className="block">Вуз<select className={field} name="universityId" defaultValue={view.universityId}>{view.universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    <label className="block">Курс<select className={field} name="courseId" defaultValue={view.courseId}>{view.courses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    {view.chief && <><label className="block">Причина исправления (без ПДн и секретов)<textarea className={field} name="reason" required minLength={1} maxLength={1000} /></label><label className="block">Текущий пароль<input className={field} name="password" type="password" autoComplete="current-password" required maxLength={128} /></label></>}
    {!enabled && <p>Сохранение доступно только в учебном режиме с синтетическими данными.</p>}
    <Button disabled={busy || !enabled}>Сохранить сведения</Button>
    {message && <p role="status">{message}</p>}
  </form>;
}
