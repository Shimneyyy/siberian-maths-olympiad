"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import type { registrationsOptions, listRegistrations, RegistrationsQuery } from "@/lib/registrations";
type Options = Awaited<ReturnType<typeof registrationsOptions>>;
type Result = Awaited<ReturnType<typeof listRegistrations>>;
const field = "mt-2 block w-full rounded-lg border border-border bg-white p-2";
const sorts = { teamName: "Команда", fullName: "ФИО", email: "Email", universityName: "Вуз", courseLabel: "Курс (по названию)", registeredAt: "Дата регистрации", status: "Статус", format: "Формат" };
export function RegistrationsTable({ options, initial }: { options: Options; initial: Result | null }) {
  const [filters, setFilters] = useState<RegistrationsQuery>({ editionId: options.editions[0]?.id || "", search: "", sort: "fullName", direction: "asc", page: 1, pageSize: 25 });
  const [data, setData] = useState(initial);
  const [facets, setFacets] = useState(initial?.filters || { universityNames: [], courseLabels: [], teamNames: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const requestId = useRef(0);
  const appliedQuery = useRef<RegistrationsQuery | null>(initial ? filters : null);
  useEffect(() => {
    if (busy) return;
    let pending = false, disposed = false;
    const controller = new AbortController();
    async function refresh() {
      const query = appliedQuery.current;
      if (!query || pending) return;
      pending = true;
      const current = ++requestId.current;
      try {
        const response = await fetch("/api/registrations/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query), cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) });
        const result = await response.json();
        if (disposed || current !== requestId.current) return;
        if (!response.ok) {
          setData(null); setFacets({ universityNames: [], courseLabels: [], teamNames: [] });
          setMessage(result.error || "Не удалось обновить список");
          if ([401,403].includes(response.status)) appliedQuery.current = null;
          return;
        }
        setData(result as Result); setFacets((result as Result).filters); setMessage("");
      } catch {
        if (!disposed && current === requestId.current) { setData(null); setMessage("Связь потеряна. Повторное подключение выполняется автоматически."); }
      } finally { pending = false; }
    }
    const timer = setInterval(() => void refresh(), 5000);
    return () => { disposed = true; clearInterval(timer); controller.abort(); };
  }, [busy]);
  const selectedEdition = options.editions.find((e) => e.id === filters.editionId);
  function change(patch: Partial<RegistrationsQuery>) {
    appliedQuery.current = null;
    requestId.current++; setBusy(false); setMessage("");
    if ("editionId" in patch || "editionVenueId" in patch) setFacets({ universityNames: [], courseLabels: [], teamNames: [] });
    setFilters((old) => ({ ...old, ...patch, page: 1 }));
    setData(null);
  }
  async function load(query: RegistrationsQuery) {
    const current = ++requestId.current;
    setBusy(true); setMessage("");
    // Never keep another edition's or a previously authorized page visible on error.
    setData(null);
    try {
      const response = await fetch("/api/registrations/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query), cache: "no-store" });
      const result = await response.json();
      if (requestId.current !== current) return;
      if (!response.ok) { if (response.status === 401 || response.status === 403) setFacets({ universityNames: [], courseLabels: [], teamNames: [] }); setMessage(result.error || "Не удалось получить список."); return; }
      appliedQuery.current = { ...query, page: (result as Result).page };
      setFacets((result as Result).filters); setData(result as Result); setFilters({ ...query, page: (result as Result).page });
    } catch { if (requestId.current === current) setMessage("Не удалось получить список. Повторите запрос."); }
    finally { if (requestId.current === current) setBusy(false); }
  }
  async function attendance(row: Result["rows"][number], status: string) {
    const current = ++requestId.current;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId: filters.editionId, participationId: row.id, revision: row.attendance.revision, status }) });
      const result = await response.json();
      if (current !== requestId.current) return;
      if (!response.ok) { setMessage(result.error || "Не удалось изменить явку"); if ([401,403].includes(response.status)) setData(null); return; }
      setData(old => old ? { ...old, rows: old.rows.map(p => p.id === row.id ? { ...p, attendance: result } : p) } : null);
    } catch { if (current === requestId.current) setMessage("Не удалось получить ответ. Обновите список перед повтором."); }
    finally { if (current === requestId.current) setBusy(false); }
  }
  async function download() {
    const current = ++requestId.current;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/registrations/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(filters), cache: "no-store" });
      if (current !== requestId.current) return;
      if (!response.ok) { const result = await response.json(); setMessage(result.error || "Выгрузка недоступна"); if ([401,403].includes(response.status)) { setData(null); setFacets({ universityNames: [], courseLabels: [], teamNames: [] }); } return; }
      const blob = await response.blob();
      if (current !== requestId.current) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      try { link.href = url; link.download = "registrations.csv"; document.body.appendChild(link); link.click(); }
      finally { link.remove(); URL.revokeObjectURL(url); }
    } catch { if (current === requestId.current) setMessage("Не удалось скачать выгрузку"); }
    finally { if (current === requestId.current) setBusy(false); }
  }
  if (!options.editions.length) return <p>У вас нет действующих назначений на годы или площадки олимпиады.</p>;
  return <div className="space-y-6">
    <p className="text-sm text-slate-600">{options.canSeeRemote ? "Список участников доступных вам годов, включая дистанционное участие." : "Список ограничен назначенными вам площадками. Отключённые площадки сохраняют ранее зарегистрированных участников."}</p>
    <p className="text-sm text-slate-600">Применённый список обновляется каждые 5 секунд. При потере связи данные скрываются и подключение повторяется.</p>
    <form method="post" className="rounded-xl border border-border bg-white p-5" onSubmit={(event) => { event.preventDefault(); void load(filters); }}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label>Год олимпиады<select value={filters.editionId} onChange={(event) => change({ editionId: event.target.value, editionVenueId: undefined, universityName: undefined, courseLabel: undefined, teamId: undefined })} className={field}>{options.editions.map((e) => <option key={e.id} value={e.id}>{e.year} · {e.title}</option>)}</select></label>
        <label>Площадка<select value={filters.editionVenueId || ""} disabled={filters.format === "REMOTE"} onChange={(event) => change({ editionVenueId: event.target.value || undefined })} className={field}><option value="">Все доступные</option>{selectedEdition?.venues.map((v) => <option key={v.id} value={v.id}>{v.label}{!v.active && " (отключена)"}</option>)}</select></label>
        <label>ФИО или email<input type="search" maxLength={100} value={filters.search} onChange={(event) => change({ search: event.target.value })} className={field} /></label>
        <label>Статус<select value={filters.status || ""} onChange={(event) => change({ status: event.target.value as RegistrationsQuery["status"] || undefined })} className={field}><option value="">Все</option><option value="REGISTERED">Зарегистрирован</option><option value="CANCELLED">Участие отменено</option></select></label>
        <label>Вуз<input value={filters.universityName || ""} maxLength={300} list="roster-universities" onChange={(event) => change({ universityName: event.target.value || undefined })} className={field} /><datalist id="roster-universities">{facets.universityNames.map((x) => <option key={x} value={x} />)}</datalist></label>
        <label>Курс<input value={filters.courseLabel || ""} maxLength={200} list="roster-courses" onChange={(event) => change({ courseLabel: event.target.value || undefined })} className={field} /><datalist id="roster-courses">{facets.courseLabels.map((x) => <option key={x} value={x} />)}</datalist></label>
        <label>Формат<select value={filters.format || ""} onChange={(event) => change({ format: event.target.value as RegistrationsQuery["format"] || undefined, editionVenueId: event.target.value === "REMOTE" ? undefined : filters.editionVenueId })} className={field}><option value="">Все доступные</option><option value="ONSITE">Очно</option>{options.canSeeRemote && <option value="REMOTE">Дистанционно</option>}</select></label>
        <label>Команда<select value={filters.teamId || ""} onChange={event => change({ teamId: event.target.value || undefined })} className={field}><option value="">Все команды и одиночные участники</option>{filters.teamId && !facets.teamNames.some(t => t.id === filters.teamId) && <option value={filters.teamId}>Выбранная команда недоступна</option>}{facets.teamNames.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Сортировка<select value={filters.sort} onChange={(event) => change({ sort: event.target.value as RegistrationsQuery["sort"] })} className={field}>{Object.entries(sorts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Порядок<select value={filters.direction} onChange={(event) => change({ direction: event.target.value as "asc" | "desc" })} className={field}><option value="asc">По возрастанию</option><option value="desc">По убыванию</option></select></label>
        <label>Строк на странице<select value={filters.pageSize} onChange={(event) => change({ pageSize: Number(event.target.value) as RegistrationsQuery["pageSize"] })} className={field}>{[10,25,50,100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      <Button className="mt-5" disabled={busy}>{busy ? "Загрузка…" : "Показать участников"}</Button>
    </form>
    <Button variant="outline" disabled={busy} onClick={() => void download()}>Скачать CSV по фильтрам (все страницы)</Button>
    {message && <p role="alert" className="rounded-lg border border-border bg-white p-4">{message}</p>}
    <div aria-live="polite" aria-busy={busy}>
      {busy && <p>Загрузка списка…</p>}
      {!busy && !data && !message && <p>Нажмите «Показать участников», чтобы применить фильтры.</p>}
      {data && <section className="space-y-4" aria-label="Результаты поиска">
        <h2 className="text-xl font-semibold">{data.editionTitle} · {data.year}: найдено {data.total}</h2>
        {!data.rows.length ? <p>В доступной вам области нет участников, соответствующих фильтрам.</p> : <div className="overflow-x-auto rounded-xl border border-border bg-white"><table className="w-full text-left text-sm"><caption className="sr-only">Участники {data.year}, страница {data.page}</caption><thead className="bg-muted"><tr>{["ФИО","Email","Вуз","Курс","Команда","Статус","Формат и площадка","Дата регистрации (НСК)","Явка"].map((x) => <th key={x} scope="col" className="whitespace-nowrap p-3">{x}</th>)}</tr></thead><tbody>{data.rows.map((p) => <tr key={p.id} className="border-t border-border"><td className="p-3">{p.fullName}{options.canSeeRemote && <Link className="block text-primary" href={`/cabinet/correction?editionId=${data.editionId}&participationId=${p.id}`}>Исправить после закрытия</Link>}{options.canSeeRemote && p.status === "REGISTERED" && p.venue && <Link className="block text-primary" href={`/cabinet/transfer?editionId=${data.editionId}&participationId=${p.id}`}>Перенести на площадку</Link>}{options.canSeeRemote && p.status === "REGISTERED" && <Link className="block text-primary" href={`/cabinet/cancel?editionId=${data.editionId}&participationId=${p.id}`}>Отменить после закрытия</Link>}</td><td className="p-3">{p.email}</td><td className="p-3">{p.universityName}</td><td className="p-3">{p.courseLabel}</td><td className="p-3">{p.teamName || "—"}</td><td className="p-3">{p.status === "REGISTERED" ? "Зарегистрирован" : "Участие отменено"}</td><td className="p-3">{p.venue ? `${p.venue.label}${!p.venue.active ? " (отключена)" : ""}` : `Дистанционно · ${p.remoteZone === "MSK" ? "МСК UTC+3" : "НСК UTC+7"}`}</td><td className="whitespace-nowrap p-3">{new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Novosibirsk", dateStyle: "short", timeStyle: "short" }).format(new Date(p.registeredAt))}</td><td className="p-3"><select aria-label={`Явка: ${p.fullName}`} value={p.attendance.status} disabled={busy} onChange={event => void attendance(p, event.target.value)} className={field}><option value="UNMARKED">Не отмечено</option><option value="PRESENT">Присутствовал</option><option value="ABSENT">Не присутствовал</option></select></td></tr>)}</tbody></table></div>}
        <nav aria-label="Страницы участников" className="flex flex-wrap items-center gap-4"><Button variant="outline" disabled={busy || data.page <= 1} onClick={() => load({ ...filters, page: data.page - 1 })}>Назад</Button><p>Страница {data.page} из {data.pages}</p><Button variant="outline" disabled={busy || data.page >= data.pages} onClick={() => load({ ...filters, page: data.page + 1 })}>Далее</Button></nav>
      </section>}
    </div>
  </div>;
}
