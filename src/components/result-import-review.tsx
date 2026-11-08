"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import type { reviewResultImports } from "@/lib/result-imports";
type Review = Awaited<ReturnType<typeof reviewResultImports>>;
export function ResultImportReview({ editions }: { editions: { id: string; year: number }[] }) {
  const hydrated = useHydrated();
  const [editionId, setEdition] = useState(editions[0]?.id ?? ""), [batchId, setBatch] = useState<string | undefined>();
  const [page, setPage] = useState(1), [data, setData] = useState<Review | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function load(batch: string | undefined, number = 1) {
    setBusy(true); setData(null); setMessage("");
    try {
      const response = await fetch("/api/results/import/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId, batchId: batch, page: number }), cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Ошибка загрузки");
      setData(result); setBatch(batch); setPage(number);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Ошибка"); } finally { setBusy(false); }
  }
  return <section className="space-y-4 border-t pt-6"><h2 className="text-2xl">Проверка сохранённых загрузок</h2>
    <p>Только главный организатор назначенного года. Откройте загрузку и проверьте её перед отдельной публикацией.</p>
    <label>Год для проверки<select className="block rounded border p-2" disabled={busy} value={editionId} onChange={e => { setEdition(e.target.value); setData(null); setBatch(undefined); setPage(1); setMessage(""); }}>{editions.map(e => <option key={e.id} value={e.id}>{e.year}</option>)}</select></label>
    <Button disabled={!hydrated || busy || !editionId} onClick={() => load(undefined)}>Показать сохранённые загрузки</Button>
    {message && <p role="status">{message}</p>}
    {data && <><p role="status">Найдено: {data.total}. Страница: {page}.</p>
      {data.batches.map(b => <article key={b.id} className="rounded border p-3"><p>{b.kind === "FINAL" ? "Итоговые" : "Предварительные"} · {new Date(b.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Novosibirsk" })} · {b.publication ? "Опубликовано" : "Не опубликовано"} · загружено {b.importedCount}, пропущено {b.rejectedCount}</p><Button disabled={busy} onClick={() => load(b.id)}>Проверить результаты этой загрузки</Button></article>)}
      {batchId && <div className="overflow-auto"><table className="w-full text-left"><caption>Сохранённые личные результаты</caption><thead><tr><th>ФИО</th><th>Баллы по задачам</th><th>Сумма</th><th>Приз</th></tr></thead><tbody>{data.results.map(r => <tr key={r.id}><td>{r.fullName}</td><td>{r.scores.map(s => `${s.ordinal}: ${s.score ?? "—"}`).join(" · ")}</td><td>{r.total ?? "—"}</td><td>{r.prize ?? "—"}</td></tr>)}</tbody></table></div>}
      {batchId && !data.publication && <form key={batchId} method="post" className="space-y-3" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget, values = new FormData(form); setBusy(true); setMessage("");
        try { const response = await fetch("/api/results/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId, batchId, password: values.get("password"), confirmed: values.get("confirmed") === "on" }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Ошибка публикации"); await load(batchId, page); setMessage("Загрузка опубликована. Уведомления поставлены в очередь."); } catch (error) { setMessage(error instanceof Error ? error.message : "Ошибка"); } finally { form.reset(); setBusy(false); }
      }}><label>Пароль для публикации<input className="block rounded border p-2" type="password" name="password" required autoComplete="current-password" maxLength={128} disabled={busy} /></label><label><input type="checkbox" name="confirmed" required disabled={busy} /> Подтверждаю публикацию всей выбранной загрузки</label><Button disabled={!hydrated || busy}>Опубликовать эту загрузку</Button></form>}
      {batchId && data.publication && <p>Загрузка опубликована</p>}
      <Button disabled={busy || page === 1} onClick={() => load(batchId, page - 1)}>Предыдущая страница</Button><Button disabled={busy || page * 25 >= data.total} onClick={() => load(batchId, page + 1)}>Следующая страница</Button>
    </>}
  </section>;
}
