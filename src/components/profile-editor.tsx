"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useHydrated } from "@/lib/use-hydrated";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import type { profileView } from "@/lib/corrections";
type View = Awaited<ReturnType<typeof profileView>> & { editionId?: string; participationId?: string };
const field = "mt-2 block w-full rounded border border-border p-3";
export function ProfileEditor({ view, enabled }: { view: View; enabled: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const annual = !!view.participationId;
  return <form method="post" className="space-y-4 rounded border border-border bg-white p-6" onSubmit={async event => {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const body = { fullName: data.get("fullName"), universityId: data.get("universityId"), courseId: data.get("courseId"), revision: view.revision,
        ...(annual ? { editionId: view.editionId, participationId: view.participationId } : {}) };
      const response = await clientFetch(annual ? "/api/participations/correction" : "/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      setMessage(response.ok ? "Изменения сохранены." : result.error || "Не удалось сохранить");
      if (response.ok) router.refresh();
    } catch { setMessage("Не удалось получить ответ. Обновите страницу перед повтором."); }
    finally { setBusy(false); }
  }}>
    <label className="block">ФИО<input className={field} name="fullName" defaultValue={view.fullName} required minLength={3} maxLength={200} /></label>
    <label className="block">Вуз<select className={field} name="universityId" defaultValue={view.universityId}>{view.universities.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    <label className="block">Курс<select className={field} name="courseId" defaultValue={view.courseId}>{view.courses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    {!enabled && <p>Сохранение сейчас недоступно.</p>}
    <Button disabled={busy || !enabled || !hydrated}>Сохранить сведения</Button>
    {message && <p role="status">{message}</p>}
  </form>;
}
