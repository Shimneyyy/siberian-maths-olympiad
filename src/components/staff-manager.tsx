"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
type Venue = { id: string; editionId: string; title: string };
type Staff = { userId: string; name: string; venueId: string; editionId: string; title: string };
export function StaffManager({ venues, staff }: { venues: Venue[]; staff: Staff[] }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function mutate(method: string, body: Record<string, unknown>) {
    if (!password) { setMessage("Введите текущий пароль для подтверждения действия."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/staff", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, password }) });
      setMessage(response.ok ? "Изменения сохранены." : "Не удалось выполнить действие. Проверьте полномочия и данные.");
      if (response.ok) router.refresh();
    } catch { setMessage("Повторите позже."); } finally { setBusy(false); setPassword(""); }
  }
  return <section className="mt-8 space-y-4 rounded-xl border border-border bg-white p-6">
    <h2 className="text-xl font-semibold">Организаторы площадок</h2>
    <label className="block">Текущий пароль для подтверждения изменений<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 block w-full rounded-lg border border-border p-2" /></label>
    {!venues.length ? <p>Для назначения нужны площадки вашего года олимпиады.</p> : <form method="post" className="space-y-4" onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const venue = venues.find((x) => x.id === form.get("venue")); if (!venue) return;
      await mutate("POST", { editionId: venue.editionId, editionVenueId: venue.id, email: form.get("email"), name: form.get("name") });
    }}>
      <p className="text-sm text-slate-600">Учебный режим: только вымышленные имена и email @example.test. Новый организатор получает письмо для установки пароля, подтверждает email и включает TOTP.</p>
      <label className="block">ФИО<input name="name" minLength={3} maxLength={200} required className="mt-2 block w-full rounded-lg border border-border p-2" /></label>
      <label className="block">Email<input name="email" type="email" required className="mt-2 block w-full rounded-lg border border-border p-2" /></label>
      <label className="block">Площадка<select name="venue" className="mt-2 block w-full rounded-lg border border-border p-2">{venues.map((v) => <option value={v.id} key={v.id}>{v.title}</option>)}</select></label>
      <Button disabled={busy}>Назначить организатора</Button>
    </form>}
    {staff.map((x) => <div key={`${x.userId}-${x.venueId}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p>{x.name} · {x.title}</p><Button variant="outline" disabled={busy} onClick={() => mutate("DELETE", { editionId: x.editionId, editionVenueId: x.venueId, userId: x.userId })}>Отозвать доступ</Button></div>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
