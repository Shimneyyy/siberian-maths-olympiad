"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import type { previewAccountImport } from "@/lib/account-imports";
const labels: Record<string, string> = { DUPLICATE: "Дубль владельца или логина: все строки отклонены", COLUMN_COUNT: "Нужно три столбца", INVALID_USER_ID: "Неверный UUID пользователя", INVALID_LOGIN: "Неверный логин", INVALID_PASSWORD: "Пароль должен содержать 1–128 символов без управляющих символов", PARTICIPANT_UNAVAILABLE: "Владелец недоступен в выбранном году", ACCOUNT_UNAVAILABLE: "У владельца уже есть аккаунт/заявка или логин недоступен" };
export function AccountImportManager({ editions }: { editions: { id: string; year: number }[] }) {
  const hydrated = useHydrated(), fileInput = useRef<HTMLInputElement>(null);
  const [editionId, setEdition] = useState(editions[0]?.id ?? ""), [csv, setCsv] = useState(""), [preview, setPreview] = useState<Awaited<ReturnType<typeof previewAccountImport>> | null>(null), [id, setId] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  function clear() { setPreview(null); setId(""); setMessage(""); }
  async function api(path: string, body: unknown) {
    const response = await fetch(`/api/nsuhw/import/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || "Не удалось выполнить импорт"); return value;
  }
  return <section className="space-y-4">
    <p>Только синтетические данные уже действующих аккаунтов. Импорт не создаёт аккаунты на nsuhw. Существующие аккаунты и legacy-заявки не заменяются.</p>
    <p>UTF-8 CSV до 512 КиБ и 1000 строк: ID пользователя ЛК,логин nsuhw,пароль nsuhw. Сопоставление по UUID, не ФИО. Все дубли владельца или логина отклоняются. Пароли в отчёте не показываются.</p>
    <label>Год импорта<select className="block rounded border p-2" value={editionId} disabled={busy} onChange={e => { setEdition(e.target.value); clear(); }}>{editions.map(e => <option key={e.id} value={e.id}>{e.year}</option>)}</select></label>
    <label>CSV аккаунтов<input ref={fileInput} className="block" type="file" accept=".csv,text/csv" disabled={!hydrated || busy} onChange={async e => {
      const file = e.target.files?.[0]; clear(); setCsv(""); if (!file) return;
      if (file.size > 524288) { setMessage("Файл больше 512 КиБ"); return; }
      setBusy(true); try { setCsv(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())); } catch { setMessage("Нужен корректный UTF-8 CSV"); } finally { setBusy(false); }
    }} /></label>
    <Button disabled={!hydrated || busy || !editionId || !csv} onClick={async () => { clear(); setBusy(true); try { setPreview(await api("preview", { editionId, csv })); setId(crypto.randomUUID()); } catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); } }}>Проверить аккаунты</Button>
    {preview && <><p role="status">Верных строк: {preview.validCount}. Ошибок: {preview.rejectedCount}.</p><table className="w-full text-left"><caption>Проверка аккаунтов без паролей</caption><thead><tr><th>Строка</th><th>Участник</th><th>Проверка</th></tr></thead><tbody>{preview.rows.map(r => <tr key={r.line}><td>{r.line}</td><td>{r.fullName ?? "—"}</td><td>{r.error ? labels[r.error] || "Ошибка строки" : "Готова"}</td></tr>)}</tbody></table>
      {preview.validCount > 0 && <form key={id} method="post" className="space-y-3" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget, data = new FormData(form); setBusy(true);
        try { const result = await api("apply", { editionId, csv, id, selectionHash: preview.selectionHash, password: data.get("password"), confirmed: data.get("confirmed") === "on" }); setCsv(""); setPreview(null); setId(""); if (fileInput.current) fileInput.current.value = ""; setMessage(`Импортировано: ${result.importedCount}. Пропущено: ${result.rejectedCount}.`); } catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка"); } finally { form.reset(); setBusy(false); }
      }}><label>Текущий пароль<input className="block rounded border p-2" name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} /></label><label className="block"><input type="checkbox" name="confirmed" required disabled={busy} /> Подтверждаю источник готовых аккаунтов и применение только верных строк</label><Button disabled={!hydrated || busy}>Импортировать аккаунты</Button></form>}</>}
    {message && <p role="status">{message}</p>}
    <p>После успешного импорта удалите исходный файл со своего компьютера. Участникам придёт уведомление без пароля; просмотр данных доступен только владельцу после повторной проверки пароля ЛК.</p>
  </section>;
}
