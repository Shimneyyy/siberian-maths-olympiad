"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import type { previewResultImport } from "@/lib/result-imports";
type Preview = Awaited<ReturnType<typeof previewResultImport>>;
const labels: Record<string, string> = { DUPLICATE: "Дубль участника — все его строки отклонены", COLUMN_COUNT: "Неверное число столбцов", INVALID_LOGIN: "Неверный логин", INVALID_PRIZE: "Приз длиннее 200 символов", INVALID_SCORE: "Нужны целые баллы от 0 до 2147483647 или пустое поле", PARTICIPANT_UNAVAILABLE: "Нет однозначного подтверждённого аккаунта участника этого года", ALREADY_EXISTS: "Результат этого вида уже загружен" };
export function ResultImportManager({ editions }: { editions: { id: string; year: number }[] }) {
  const hydrated = useHydrated();
  const [editionId, setEdition] = useState(editions[0]?.id ?? ""), [kind, setKind] = useState("PRELIMINARY");
  const [csv, setCsv] = useState(""), [preview, setPreview] = useState<Preview | null>(null), [id, setId] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [applied, setApplied] = useState(false);
  const field = "block w-full rounded border p-2";
  function clear() { setPreview(null); setId(""); setApplied(false); setMessage(""); }
  async function api(path: string, body: unknown) {
    const response = await fetch(`/api/results/import/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Повторите позже"); return data;
  }
  return <section className="space-y-5">
    <p>Только синтетические данные. Загрузка не публикует результаты и не отправляет письма. Публикация будет реализована отдельно.</p>
    <p>CSV UTF-8, разделитель — запятая. Заголовки: Логин,Задача 1,Задача 2,…,Сумма,Приз. От 1 до 50 задач. Логин nsuhw должен быть подтверждён и совпадать точно, включая регистр. Только личные результаты.</p>
    <p>Баллы — целые от 0 до 2147483647; пустое поле означает «не указан», а не ноль. Сумма загружается готовой, приз — текст до 200 символов. Все дубли участника отклоняются, существующие результаты не заменяются.</p>
    <label>Год<select className={field} value={editionId} disabled={busy} onChange={e => { setEdition(e.target.value); clear(); }}>{editions.map(e => <option key={e.id} value={e.id}>{e.year}</option>)}</select></label>
    <label>Вид результатов<select className={field} value={kind} disabled={busy} onChange={e => { setKind(e.target.value); clear(); }}><option value="PRELIMINARY">Предварительные</option><option value="FINAL">Итоговые</option></select></label>
    <label>Файл CSV (до 512 КиБ)<input className={field} type="file" accept=".csv,text/csv" disabled={!hydrated || busy} onChange={async e => {
      const file = e.target.files?.[0]; clear(); setCsv(""); if (!file) return;
      if (file.size > 524288) { setMessage("Файл больше 512 КиБ"); return; }
      setBusy(true); try { setCsv(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())); } catch { setMessage("Не удалось прочитать UTF-8 CSV"); } finally { setBusy(false); }
    }} /></label>
    <Button disabled={!hydrated || busy || !editionId || !csv} onClick={async () => {
      clear(); setBusy(true); try { setPreview(await api("preview", { editionId, kind, csv })); setId(crypto.randomUUID()); } catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); }
    }}>Предпросмотр результатов</Button>
    {preview && <>
      <p role="status">Верных строк: {preview.validCount}. Ошибок: {preview.rejectedCount}. Задач: {preview.taskCount}.</p>
      <div className="max-h-96 overflow-auto"><table className="w-full text-left"><caption>Предпросмотр CSV</caption><thead><tr><th>Строка</th><th>Логин</th><th>Баллы по задачам</th><th>Сумма</th><th>Приз</th><th>Проверка</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.line}><td>{row.line}</td><td>{row.login}</td><td>{row.scores.map(v => v ?? "—").join(" · ")}</td><td>{row.total ?? "—"}</td><td>{row.prize ?? "—"}</td><td>{row.error ? labels[row.error] || "Ошибка строки" : "Готова к загрузке"}</td></tr>)}</tbody></table></div>
      {!applied && preview.validCount > 0 && <form key={id} method="post" className="space-y-3" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget, data = new FormData(form); setBusy(true); setMessage("");
        try { const result = await api("apply", { editionId, kind, csv, id, selectionHash: preview.selectionHash, password: data.get("password"), confirmed: data.get("confirmed") === "on" }); setApplied(true); setMessage(`Загружено: ${result.importedCount}. Пропущено: ${result.rejectedCount}. Результаты не опубликованы.`); } catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка"); } finally { form.reset(); setBusy(false); }
      }}><label>Текущий пароль<input className={field} name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} /></label><label><input name="confirmed" type="checkbox" required disabled={busy} /> Подтверждаю загрузку только верных строк; ошибочные будут пропущены</label><Button disabled={!hydrated || busy}>Загрузить верные строки</Button></form>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
