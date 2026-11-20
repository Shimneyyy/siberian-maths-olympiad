"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useRef, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
type Batch = { id: string; editionId: string; editionVenueId: string | null; subjectTemplate: string; bodyTemplate: string };
export function MailManager({ editions }: { editions: { id: string; year: number; venues: { id: string; name: string }[] }[] }) {
  const hydrated = useHydrated(), pending = useRef<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [editionId, setEdition] = useState(editions[0]?.id ?? ""), [repeat, setRepeat] = useState<Batch | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const field = "block w-full rounded border p-2";
  async function api(path: string, body: unknown) {
    const response = await clientFetch(`/api/mail-batches${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "Ошибка рассылки"); return result;
  }
  async function load() { setBatches(await api("/search", { editionId })); }
  return <section className="space-y-4"><p>Только синтетические данные. Не вставляйте пароли или персональные сведения в шаблон. Разрешены {'{{name}}, {{year}}, {{university}}, {{team}}, {{venue}}'}. Письмо отправляется обычным текстом.</p>
    <label>Год<select className={field} value={editionId} disabled={busy} onChange={e => { setEdition(e.target.value); setRepeat(null); setBatches([]); pending.current = null; setMessage(""); }}>{editions.map(e => <option key={e.id} value={e.id}>{e.year}</option>)}</select></label>
    <Button disabled={!hydrated || busy || !editionId} onClick={async () => { setBusy(true); try { await load(); } catch { setBatches([]); setMessage("Не удалось загрузить рассылки"); } finally { setBusy(false); } }}>Показать рассылки</Button>
    <form key={`${editionId}:${repeat?.id ?? "new"}:${formVersion}`} method="post" className="space-y-4" onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget); const element = e.currentTarget; setBusy(true); setMessage("");
      pending.current ??= crypto.randomUUID();
      try {
        const result = await api("", { id: pending.current, editionId, editionVenueId: repeat ? repeat.editionVenueId : form.get("venue") || null, subjectTemplate: repeat ? repeat.subjectTemplate : form.get("subject"), bodyTemplate: repeat ? repeat.bodyTemplate : form.get("body"), repeatOf: repeat?.id ?? null, confirm: form.get("confirm") === "on", confirmRepeat: form.get("confirmRepeat") === "on", password: form.get("password") });
        pending.current = null; setRepeat(null); element.reset(); await load(); setMessage(`В очередь поставлено писем: ${result.count}. Доставка выполняется worker.`);
      } catch(e) { setMessage(e instanceof Error ? e.message : "Повторите позже"); } finally { setBusy(false); }
    }}>
      <h2>{repeat ? "Повторная отправка актуальной аудитории" : "Новая рассылка"}</h2>
      <label>Аудитория<select name="venue" className={field} disabled={!!repeat} defaultValue={repeat?.editionVenueId ?? ""}><option value="">Все участники года, включая отменившихся</option>{editions.find(e => e.id === editionId)?.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label>Тема<input className={field} name="subject" required maxLength={200} readOnly={!!repeat} defaultValue={repeat?.subjectTemplate} /></label>
      <label>Текст письма<textarea className={field} name="body" required maxLength={5000} readOnly={!!repeat} defaultValue={repeat?.bodyTemplate} /></label>
      <label>Текущий пароль<input className={field} name="password" type="password" required autoComplete="current-password" /></label>
      <label><input type="checkbox" name="confirm" required /> Подтверждаю отправку выбранной аудитории</label>
      {repeat && <label><input type="checkbox" name="confirmRepeat" required /> Отдельно подтверждаю повторную отправку актуальным участникам области, включая отменившихся</label>}
      <Button disabled={!hydrated || busy || !editionId}>Поставить письма в очередь</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { setRepeat(null); setFormVersion(v => v + 1); pending.current = null; setMessage("Для новой отправки заполните форму и подтвердите её заново"); }}>Новая отправка</Button>
    </form>
    {message && <p role="status">{message}</p>}
    {batches.map(b => <article key={b.id} className="rounded border p-4"><h2>{b.subjectTemplate}</h2><p className="whitespace-pre-wrap">{b.bodyTemplate}</p><Button disabled={busy} onClick={() => { setRepeat(b); setFormVersion(v => v + 1); pending.current = null; setMessage(""); }}>Подготовить повторную отправку</Button></article>)}
  </section>;
}
