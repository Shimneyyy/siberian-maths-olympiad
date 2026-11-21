"use client";
import { RESULT_CSV_LIMIT } from "@/lib/result-csv-limits";
import { clientFetch } from "@/lib/client-fetch";
import { ImportResponseError, readImportResponse } from "@/lib/import-response";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import type { previewResultImport } from "@/lib/result-imports";
import type { previewTeamResults } from "@/lib/team-results";
type Preview = Awaited<ReturnType<typeof previewResultImport>> | Awaited<ReturnType<typeof previewTeamResults>>;
const labels: Record<string, string> = { INVALID_TEAM_ID: "Неверный ID команды", TEAM_UNAVAILABLE: "Команда недоступна в этом году", DUPLICATE: "Дубль участника — все его строки отклонены", COLUMN_COUNT: "Неверное число столбцов", INVALID_LOGIN: "Неверный логин", INVALID_PRIZE: "Приз длиннее 200 символов", INVALID_SCORE: "Нужны целые баллы от 0 до 2147483647 или пустое поле", PARTICIPANT_UNAVAILABLE: "Нет однозначного логина участника этого года", ALREADY_EXISTS: "Результат этого вида уже загружен" };
export function ResultImportManager({ editions, team = false }: { editions: { id: string; year: number }[]; team?: boolean }) {
  const hydrated = useHydrated(), fileInput = useRef<HTMLInputElement>(null);
  const [editionId, setEdition] = useState(editions[0]?.id ?? ""), [kind, setKind] = useState("PRELIMINARY");
  const [csv, setCsv] = useState(""), [preview, setPreview] = useState<Preview | null>(null), [id, setId] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [applied, setApplied] = useState(false);
  const field = "block w-full rounded border p-2";
  function clear() { setPreview(null); setId(""); setApplied(false); setMessage(""); }
  function importFailed(e: unknown, applying = false) {
    if (e instanceof ImportResponseError && [401, 403, 409].includes(e.status)) {
      setPreview(null); setId("");
      if (e.status !== 409) { setCsv(""); if (fileInput.current) fileInput.current.value = ""; }
      setMessage(e.status === 409 ? `${e.message}. Выполните новый предпросмотр.` : `${e.message}. Выберите файл и проверьте доступ заново.`);
    } else {
      // Apply may have committed: retain CSV, UUID and hash for an idempotent retry.
      setMessage(e instanceof ImportResponseError ? e.message : applying
        ? "Не удалось получить ответ. Повторите импорт этой же формы: повтор не создаёт дубли."
        : "Не удалось получить предпросмотр. Повторите проверку файла.");
    }
  }
  async function api(path: string, body: unknown) {
    const response = await clientFetch(team ? `/api/results/teams/${path}` : `/api/results/import/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return readImportResponse(response, "Не удалось выполнить импорт результатов");
  }
  return <section className="space-y-5">
    {team ? <><p>Командные результаты: CSV UTF-8 до 2 МиБ. Столбцы: ID команды,Курсы участников,Задача 1,…,Сумма баллов,Приз. Название команды и Вуз необязательны; Приз тоже необязателен.</p><p>Используйте ID из списка команд ниже. Состав, ФИО, курсы и вузы фиксируются по заявкам при импорте. Курсы из CSV показаны для сверки, не меняют заявки. Изменение или удаление команды позже не переносит достижения другим людям.</p><p>После загрузки откройте управление результатами и отдельно опубликуйте нужную версию. Импорт сам ничего не публикует.</p></> : <>
    <p>Загрузка не публикует результаты и не отправляет письма. После загрузки проверьте сохранённые результаты и опубликуйте выбранную загрузку отдельно.</p>
    <p>CSV UTF-8, разделитель — запятая. Шаблон: ФИО,Курс,Вуз,Логин,Задача 1,Задача 2,…,Сумма баллов. Приз — необязательный последний столбец. От 1 до 50 задач. Поддерживается и прежний формат Логин,…,Сумма,Приз. Логин должен совпадать точно, включая регистр; старый логин используется сразу после ввода участником. Только личные результаты.</p>
    <p>Результаты связываются по логину выбранного года. ФИО, курс и вуз из файла показаны для сверки; они не изменяют профиль и не заменяют логин при сопоставлении.</p>
    <p>Баллы — целые от 0 до 2147483647; пустое поле означает «не указан», а не ноль. Сумма загружается готовой, приз — текст до 200 символов. Все дубли участника отклоняются, существующие результаты не заменяются.</p>
    </>}
    <label>Год<select className={field} value={editionId} disabled={busy} onChange={e => { setEdition(e.target.value); clear(); }}>{editions.map(e => <option key={e.id} value={e.id}>{e.year}</option>)}</select></label>
    <label>Вид результатов<select className={field} value={kind} disabled={busy} onChange={e => { setKind(e.target.value); clear(); }}><option value="PRELIMINARY">Предварительные</option><option value="FINAL">Итоговые</option></select></label>
    <label>Файл CSV (до 2 МиБ)<input className={field} ref={fileInput} type="file" accept=".csv,text/csv" disabled={!hydrated || busy} onChange={async e => {
      const file = e.target.files?.[0]; clear(); setCsv(""); if (!file) return;
      if (file.size > RESULT_CSV_LIMIT) { setMessage("Файл больше 2 МиБ"); return; }
      setBusy(true); try { setCsv(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())); } catch { setMessage("Не удалось прочитать UTF-8 CSV"); } finally { setBusy(false); }
    }} /></label>
    <Button disabled={!hydrated || busy || !editionId || !csv} onClick={async () => {
      clear(); setBusy(true); try { setPreview(await api("preview", { editionId, kind, csv })); setId(crypto.randomUUID()); } catch (e) { importFailed(e); } finally { setBusy(false); }
    }}>Предпросмотр результатов</Button>
    {preview && <>
      <p role="status">Верных строк: {preview.validCount}. Ошибок: {preview.rejectedCount}. Задач: {preview.taskCount}.</p>
      <div className="max-h-96 overflow-auto"><table className="w-full text-left"><caption>Предпросмотр CSV</caption><thead><tr><th>Строка</th><th>{team ? "Команда" : "ФИО"}</th><th>{team ? "Курсы участников" : "Курс"}</th><th>Вуз</th><th>{team ? "ID команды" : "Логин"}</th><th>Баллы по задачам</th><th>Сумма</th><th>Приз</th><th>Проверка</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.line}><td>{row.line}</td><td>{"teamName" in row ? row.teamName : row.fullName ?? "—"}</td><td>{row.course ?? "—"}{"members" in row && <ul>{row.members.map(m=><li key={m.participationId}>{m.fullName} · курс {m.courseLabel}</li>)}</ul>}</td><td>{row.university ?? "—"}</td><td>{row.login}</td><td>{row.scores.map(v => v ?? "—").join(" · ")}</td><td>{row.total ?? "—"}</td><td>{row.prize ?? "—"}</td><td>{row.error ? labels[row.error] || "Ошибка строки" : "Готова к загрузке"}</td></tr>)}</tbody></table></div>
      {!applied && preview.validCount > 0 && <form key={id} method="post" className="space-y-3" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget, data = new FormData(form); setBusy(true); setMessage("");
        try { const result = await api("apply", { editionId, kind, csv, id, selectionHash: preview.selectionHash, password: data.get("password"), confirmed: data.get("confirmed") === "on" }); setApplied(true); setMessage(`Загружено: ${result.importedCount}. Пропущено: ${result.rejectedCount}. Результаты не опубликованы.`); } catch (e) {
          importFailed(e, true);
        } finally { form.reset(); setBusy(false); }
      }}><label>Текущий пароль<input className={field} name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} /></label><label><input name="confirmed" type="checkbox" required disabled={busy} /> Подтверждаю загрузку только верных строк; ошибочные будут пропущены</label><Button disabled={!hydrated || busy}>Загрузить верные строки</Button></form>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
