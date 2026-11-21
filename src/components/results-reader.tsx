"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import type { resultsView } from "@/lib/results";
export function ResultsReader({ editions }: { editions: { id: string; year: number }[] }) {
  const hydrated = useHydrated();
  const [editionId, setEdition] = useState(editions[0]?.id ?? ""), [page, setPage] = useState(1), [data, setData] = useState<Awaited<ReturnType<typeof resultsView>> | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load(number: number) {
    setBusy(true); setData(null); setError("");
    try { const response = await clientFetch("/api/results/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId, page: number }), cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Ошибка загрузки"); setData(result); setPage(number); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); }
  }
  return <section className="space-y-4"><label>Год результатов<select disabled={busy} value={editionId} onChange={e => { setEdition(e.target.value); setData(null); setPage(1); setError(""); }}>{editions.map(e => <option key={e.id} value={e.id}>{e.year}</option>)}</select></label><Button disabled={!hydrated || busy || !editionId} onClick={() => load(1)}>Показать результаты</Button>
    {error && <p role="status">{error}</p>}{data && <><p role="status">Опубликованных результатов: {data.total}.</p><div className="overflow-auto"><table className="w-full text-left"><caption>Опубликованные личные результаты</caption><thead><tr><th>ФИО</th><th>Вид</th><th>Баллы по задачам</th><th>Сумма</th><th>Приз</th></tr></thead><tbody>{data.rows.map(r => <tr key={r.id}><td>{r.fullName}{r.teamName&&<ul>{r.members.map((m,i)=><li key={i}>{m.fullName} · курс {m.courseLabel} · {m.universityName}</li>)}</ul>}</td><td>{r.kind === "FINAL" ? "Итоговые" : "Предварительные"}</td><td>{r.scores.map(s => `${s.ordinal}: ${s.score ?? "—"}`).join(" · ")}</td><td>{r.total ?? "—"}</td><td>{r.prize ?? "—"}</td></tr>)}</tbody></table></div><Button disabled={busy || page === 1} onClick={() => load(page - 1)}>Предыдущая страница</Button><Button disabled={busy || page * 25 >= data.total} onClick={() => load(page + 1)}>Следующая страница</Button></>}
  </section>;
}
