"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import type { studentOlympiadView } from "@/lib/olympiad-view";
type View = Awaited<ReturnType<typeof studentOlympiadView>>;
const field = "mt-2 block w-full rounded-lg border border-border bg-white p-3";
const states = { OPEN: "Регистрация открыта", CLOSED: "Регистрация завершена", UPCOMING: "Регистрация ещё не началась", MANUALLY_CLOSED: "Регистрация закрыта организатором", UNCONFIGURED: "Сроки регистрации пока не объявлены" };
function date(value: string) { return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Novosibirsk", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function EditionRegistration({ edition, view, enabled }: { edition: View["editions"][number]; view: View; enabled: boolean }) {
  const router = useRouter();
  const [format, setFormat] = useState("ONSITE");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const existing = view.participations.find((p) => p.editionId === edition.id);
  return <article className="space-y-4 rounded-xl border border-border bg-white p-6">
    <h2 className="text-2xl font-semibold">{edition.title} · {edition.year}{edition.isCurrent && <span className="ml-3 text-sm text-primary">Текущая олимпиада</span>}</h2>
    <p>{states[edition.state]}</p>
    {edition.opensAt && edition.closesAt && <p className="text-sm text-slate-600">С {date(edition.opensAt)} до {date(edition.closesAt)} (Новосибирск, UTC+7). В момент окончания приём закрывается.</p>}
    {existing ? <p className="font-medium text-primary">{existing.status === "REGISTERED" ? "Вы зарегистрированы на этот год. Сведения — в истории ниже." : "Участие отменено."}</p> : edition.state === "OPEN" && enabled && view.profile ? <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setMessage("");
      const form = new FormData(event.currentTarget);
      try {
        const response = await fetch("/api/participations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          editionId: edition.id, fullName: form.get("fullName"), universityId: form.get("universityId"), courseId: form.get("courseId"), format,
          ...(format === "ONSITE" ? { editionVenueId: form.get("editionVenueId") } : { remoteZone: form.get("remoteZone") }),
        }) });
        const result = await response.json() as { error?: string };
        if (!response.ok) { setMessage(result.error || "Регистрация не завершена."); return; }
        setMessage("Участие зарегистрировано."); router.refresh();
      } catch { setMessage("Не удалось получить ответ. Обновите страницу: повторный запрос не создаст вторую регистрацию."); }
      finally { setBusy(false); }
    }}>
      <p className="text-sm text-slate-600">Подтвердите данные для участия в этом году. Они сохранятся в профиле; сведения прошлых лет останутся прежними.</p>
      <label className="block">ФИО<input name="fullName" defaultValue={view.profile.fullName} required minLength={3} maxLength={200} className={field} /></label>
      <label className="block">Университет<select name="universityId" defaultValue={view.profile.universityId} required className={field}>{view.universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="block">Курс<select name="courseId" defaultValue={view.profile.courseId} required className={field}>{view.courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="block">Формат участия<select value={format} onChange={(event) => setFormat(event.target.value)} className={field}><option value="ONSITE">Очно</option><option value="REMOTE">Дистанционно</option></select></label>
      {format === "ONSITE" ? <label className="block">Площадка<select name="editionVenueId" required className={field} defaultValue=""><option value="" disabled>Выберите площадку</option>{edition.venues.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.address}</option>)}</select></label> : <label className="block">Часовой пояс<select name="remoteZone" className={field}><option value="NSK">НСК · UTC+7</option><option value="MSK">МСК · UTC+3</option></select></label>}
      {format === "ONSITE" && !edition.venues.length && <p>Очные площадки пока недоступны. Можно выбрать дистанционный формат.</p>}
      <p className="text-sm text-slate-600">После регистрации самостоятельно сменить площадку нельзя.</p>
      <Button disabled={busy || (format === "ONSITE" && !edition.venues.length)}>{busy ? "Сохраняем…" : `Буду участвовать в СМО ${edition.year}`}</Button>
      {message && <p role="status">{message}</p>}
    </form> : edition.state === "OPEN" && <p className="text-sm text-slate-600">Учебная регистрация доступна только с вымышленными данными в тестовом режиме. Реальный сбор ПДн пока закрыт.</p>}
  </article>;
}
export function AnnualRegistration({ view, enabled }: { view: View; enabled: boolean }) {
  return <div className="space-y-8">
    <section aria-label="Олимпиады" className="space-y-5">{view.editions.length ? view.editions.map((e) => <EditionRegistration key={`${e.id}-${!!view.participations.find((p) => p.editionId === e.id)}`} edition={e} view={view} enabled={enabled} />) : <p>Выпуски олимпиады пока не объявлены.</p>}</section>
    <section className="space-y-4" aria-label="История участия"><h2 className="text-2xl font-semibold">Моё участие по годам</h2>
      {!view.participations.length && <p>Вы ещё не зарегистрированы на олимпиаду.</p>}
      {view.participations.map((p) => <article key={p.id} className="space-y-2 rounded-xl border border-border bg-white p-6">
        <h3 className="text-xl font-semibold">{p.title} · {p.year}</h3>
        <p>{p.fullName} · {p.universityName} · {p.courseLabel}</p>
        <p>{p.status === "REGISTERED" ? "Зарегистрирован" : "Участие отменено"} · {p.format === "ONSITE" ? "Очно" : `Дистанционно · ${p.remoteZone === "MSK" ? "МСК UTC+3" : "НСК UTC+7"}`}</p>
        {p.venue && <><p>{p.venue.label} · {p.venue.address}{p.venue.room && ` · ${p.venue.room}`}</p>{p.venue.instructions && <p className="whitespace-pre-wrap text-sm">{p.venue.instructions}</p>}{!p.venue.active && <p className="text-sm">Площадка закрыта для новых регистраций. Ваша запись сохранена.</p>}</>}
        <p className="text-sm text-slate-600">Регистрация: {date(p.registeredAt)} (Новосибирск)</p>
        {p.status === "REGISTERED" && view.editions.some(e => e.id === p.editionId && ["OPEN", "UPCOMING"].includes(e.state)) && <Link href={`/cabinet/correction?editionId=${p.editionId}&participationId=${p.id}`} className="block text-primary">Исправить сведения заявки</Link>}

        <a href="https://nsuhw.ru" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-block pt-2 text-primary">Перейти на nsuhw.ru ↗</a>
      </article>)}
    </section>
  </div>;
}
