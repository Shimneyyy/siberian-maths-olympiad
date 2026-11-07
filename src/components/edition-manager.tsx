"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import type { organizerOlympiadView } from "@/lib/olympiad-view";
type Editions = Awaited<ReturnType<typeof organizerOlympiadView>>;
const field = "mt-2 block w-full rounded-lg border border-border bg-white p-3";
function ManageEdition({ edition, knownVenues }: { edition: Editions[number]; knownVenues: { id: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function send(path: string, method: string, data: unknown) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json() as { error?: string };
      setMessage(response.ok ? "Изменения сохранены." : result.error || "Не удалось сохранить.");
      if (response.ok) router.refresh();
    } catch { setMessage("Не удалось получить ответ. Обновите страницу перед повторной попыткой."); }
    finally { setBusy(false); }
  }
  const siteData = (form: FormData) => ({ editionId: edition.id, label: form.get("label"), address: form.get("address"), room: form.get("room"), instructions: form.get("instructions") });
  return <section className="space-y-6 rounded-xl border border-border bg-white p-6">
    <h2 className="text-2xl font-semibold">{edition.title} · {edition.year}{edition.isCurrent && " · Текущая"}</h2>
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      await send("/api/editions", "PATCH", { editionId: edition.id, revision: edition.revision, title: form.get("title"), registrationOpensAt: edition.opensAt, registrationClosesAt: edition.closesAt, registrationManuallyClosed: edition.registrationManuallyClosed, isCurrent: edition.isCurrent || form.get("current") === "on" });
    }}>
      <label className="block">Название<input name="title" required maxLength={200} defaultValue={edition.title} className={field} /></label>
      <p>Сроки и ручное закрытие меняет только технический администратор.</p>
      {!edition.isCurrent && <label className="flex gap-3"><input name="current" type="checkbox" />Сделать этот выпуск текущим</label>}
      <p className="text-sm text-slate-600">Для смены текущего выпуска нужны полномочия на прежний и новый годы.</p>
      <Button disabled={busy}>Сохранить название и текущий выпуск</Button>
    </form>
    <h3 className="border-t border-border pt-6 text-xl font-semibold">Площадки этого года</h3>
    {!edition.venues.length && <p>Площадки ещё не добавлены.</p>}
    {edition.venues.map((v) => <form key={`${v.id}-${v.revision}`} className="space-y-3 rounded-lg border border-border p-4" onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      await send("/api/venues", "PATCH", { ...siteData(form), editionVenueId: v.id, revision: v.revision, active: form.get("active") === "on" });
    }}>
      <label className="block">Название площадки<input name="label" required maxLength={200} defaultValue={v.label} className={field} /></label>
      <label className="block">Адрес<input name="address" required maxLength={500} defaultValue={v.address} className={field} /></label>
      <label className="block">Аудитория<input name="room" maxLength={200} defaultValue={v.room} className={field} /></label>
      <label className="block">Регламент и правила прохода<textarea name="instructions" maxLength={4000} defaultValue={v.instructions} className={field} /></label>
      <label className="flex gap-3"><input type="checkbox" name="active" defaultChecked={v.active} />Принимать новые регистрации</label>
      <p className="text-sm text-slate-600">Отключение сохранит участников и их выбор площадки. Автоматического переноса нет.</p>
      <Button variant="outline" disabled={busy}>Сохранить площадку</Button>
    </form>)}
    <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-semibold">Добавить новую площадку</summary><form className="mt-4 space-y-3" onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const venueId = String(form.get("venueId") || "");
      await send("/api/venues", "POST", { ...siteData(form), ...(venueId ? { venueId } : {}) });
    }}>
      <label className="block">Основа площадки<select name="venueId" className={field}><option value="">Новая площадка</option>{knownVenues.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
      <p className="text-sm text-slate-600">Сведения ниже сохраняются отдельно для этого года и не меняют прежние выпуски.</p>
      <label className="block">Название<input name="label" required maxLength={200} className={field} /></label>
      <label className="block">Адрес<input name="address" required maxLength={500} className={field} /></label>
      <label className="block">Аудитория<input name="room" maxLength={200} className={field} /></label>
      <label className="block">Регламент и правила прохода<textarea name="instructions" maxLength={4000} className={field} /></label>
      <Button disabled={busy}>Добавить площадку</Button>
    </form></details>
    {message && <p role="status" className="rounded-lg bg-muted p-4">{message}</p>}
  </section>;
}
export function EditionManager({ editions }: { editions: Editions }) {
  const knownVenues = [...new Map(editions.flatMap((e) => e.venues.map((v) => [v.venueId, { id: v.venueId, label: v.label }] as const))).values()];
  return <div className="space-y-6">{editions.length ? editions.map((e) => <ManageEdition key={`${e.id}-${e.revision}-${e.venues.length}`} edition={e} knownVenues={knownVenues} />) : <p>У вас пока нет назначенных выпусков олимпиады.</p>}</div>;
}
