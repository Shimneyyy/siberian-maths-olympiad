"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
type Item = { id: string; editionId: string; editionVenueId: string | null; title: string; body: string; important: boolean; revision: number; publishedAt: string | null };
type Edition = { id: string; year: number; venues: { id: string; name: string }[] };
export function AnnouncementManager({ editions, chief }: { editions: Edition[]; chief: boolean }) {
  const hydrated = useHydrated();
  const [editionId, setEdition] = useState(editions[0]?.id ?? "");
  const [items, setItems] = useState<Item[]>([]), [draft, setDraft] = useState<Item | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  async function api(path: string, body: unknown) {
    const response = await clientFetch(`/api/announcements${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Повторите позже"); return data;
  }
  async function load() { setItems(await api("/search", { editionId })); }
  async function action(fn: () => Promise<void>) { setBusy(true); setMessage(""); try { await fn(); } catch (e) { setItems([]); setMessage(e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); } }
  const field = "block w-full rounded border p-2";
  return <section className="space-y-6">
    <label className="block">Год<select className={field} value={editionId} disabled={busy} onChange={e => { setEdition(e.target.value); setItems([]); setDraft(null); setMessage(""); }}>{editions.map(e => <option key={e.id} value={e.id}>{e.year}</option>)}</select></label>
    <Button disabled={!hydrated || busy || !editionId} onClick={() => action(load)}>Показать объявления</Button>
    {chief && <form key={`${editionId}:${draft?.id ?? "new"}`} method="post" className="space-y-4" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); const element = e.currentTarget; action(async () => {
      await api("", { editionId, editionVenueId: form.get("venue") || null, title: form.get("title"), body: form.get("body"), important: form.get("important") === "on", password: form.get("password"), ...(draft ? { id: draft.id, revision: draft.revision } : {}) }); setDraft(null); element.reset(); await load(); setMessage("Черновик сохранён");
    }); }}>
      <h2>{draft ? "Изменить черновик" : "Новое объявление"}</h2>
      <label className="block">Аудитория<select name="venue" className={field} defaultValue={draft?.editionVenueId ?? ""}><option value="">Все участники года</option>{editions.find(e => e.id === editionId)?.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label className="block">Заголовок<input className={field} name="title" required maxLength={200} defaultValue={draft?.title} /></label>
      <label className="block">Текст<textarea className={field} name="body" required maxLength={5000} defaultValue={draft?.body} /></label>
      <label className="block"><input type="checkbox" name="important" defaultChecked={draft?.important} /> Отправить уведомление по email при публикации</label>
      <label className="block">Текущий пароль<input className={field} name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
      <Button disabled={!hydrated || busy || !editionId}>Сохранить черновик</Button>
      {draft && <Button type="button" variant="outline" onClick={() => setDraft(null)}>Новый черновик</Button>}
    </form>}
    {message && <p role="status">{message}</p>}
    {items.map(item => <article key={item.id} className="space-y-3 rounded border p-4"><h2 className="font-semibold">{item.title}</h2>{chief && <p>{item.publishedAt ? "Опубликовано" : "Черновик"}{item.important ? " · С уведомлением по email" : ""}</p>}<p className="whitespace-pre-wrap">{item.body}</p>
      {chief && !item.publishedAt && <><Button disabled={busy} onClick={() => setDraft(item)}>Редактировать</Button><form method="post" className="space-y-2" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); action(async () => { await api("/publish", { editionId, id: item.id, revision: item.revision, password: data.get("password"), confirm: data.get("confirm") === "on" }); await load(); setMessage(item.important ? "Объявление опубликовано. Уведомления переданы на отправку." : "Объявление опубликовано."); }); }}><label className="block">Текущий пароль<input className={field} name="password" type="password" required autoComplete="current-password" /></label><label className="block"><input type="checkbox" name="confirm" required /> Подтверждаю публикацию неизменяемого текста выбранной аудитории</label><Button disabled={!hydrated || busy}>Опубликовать</Button></form></>}
    </article>)}
  </section>;
}
