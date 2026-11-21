"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { useHydrated } from "@/lib/use-hydrated";
type Edition = { id: string; title: string; year: number; revision: number; registrationOpensAt: string | null;
  registrationClosesAt: string | null; registrationManuallyClosed: boolean; staffGrants: { user: { name: string; email: string } }[] };
const field = "block w-full rounded border p-2";
const local = (value: string | null) => value ? new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 16) : "";
export function AdminManager({ editions }: { editions: Edition[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const creation = useRef<{id:string;year:number;title:string}|null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function send(path: string, body: unknown) {
    setBusy(true); setMessage("");
    try {
      const response = await clientFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      setMessage(response.ok ? (path === "/api/admin/chief" ? "Изменения сохранены. Новый главный устанавливает пароль через восстановление доступа, подтверждает email." : "Сроки регистрации сохранены.") : result.error || "Ошибка");
      if (response.ok) router.refresh();
    } catch { setMessage("Не удалось получить ответ. Обновите страницу перед повтором."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6"><p>Только синтетические аккаунты @example.test. Время — Новосибирск (UTC+7). Доступ к участникам и внешним паролям эта роль не даёт.</p>
    {!editions.length && <section aria-labelledby="admin-empty-editions" className="space-y-3 rounded border border-border bg-white p-5">
      <h2 id="admin-empty-editions" className="text-xl font-semibold">Пока нет выпусков олимпиады</h2>
      <p>Главные организаторы и сроки регистрации назначаются для конкретного выпуска. Поэтому формы появятся после его создания.</p>
      <p>Создайте выпуск формой ниже. После создания станут доступны сроки и назначение главного организатора.</p>
      <Button type="button" variant="outline" disabled={!hydrated || busy} onClick={() => router.refresh()}>Обновить список выпусков</Button>
    </section>}
    <section className="space-y-3 rounded border border-border bg-white p-5" aria-labelledby="admin-create-edition">
      <h2 id="admin-create-edition" className="text-xl font-semibold">Создать выпуск олимпиады</h2>
      <p>Создаётся новый год без сроков регистрации и назначений. Затем настройте период и назначьте главного организатора.</p>
      <form method="post" className="space-y-3" onSubmit={async event => {
        event.preventDefault(); const form=event.currentTarget,f=new FormData(form),year=Number(f.get("year")),title=String(f.get("title")||"").trim();
        if(!creation.current||creation.current.year!==year||creation.current.title!==title)creation.current={id:crypto.randomUUID(),year,title};
        setBusy(true);setMessage("");
        try {
          const response=await clientFetch("/api/admin/editions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...creation.current,password:f.get("password"),confirmed:f.get("confirmed")==="on"})});
          const result=await response.json();
          if(!response.ok){setMessage(result.error||"Не удалось создать выпуск");return;}
          creation.current=null;form.reset();setMessage(`Выпуск ${result.year} создан. Настройте сроки и назначьте главного организатора.`);router.refresh();
        }catch{setMessage("Ответ не получен. Повторите эту же форму: повтор не создаёт второй выпуск.");}
        finally{setBusy(false);const p=form.elements.namedItem("password") as HTMLInputElement,c=form.elements.namedItem("confirmed") as HTMLInputElement;p.value="";c.checked=false;}
      }}><fieldset disabled={busy||!hydrated} className="space-y-3">
        <label className="block">Год нового выпуска<input className={field} name="year" type="number" min={1} max={9999} step={1} required/></label>
        <label className="block">Название нового выпуска<input className={field} name="title" required maxLength={200}/></label>
        <label className="block">Текущий пароль для создания выпуска<input className={field} name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>
        <label className="block"><input type="checkbox" name="confirmed" required/> Подтверждаю создание нового выпуска</label>
        <Button>Создать выпуск</Button>
      </fieldset></form>
    </section>
    {editions.map(e => <section key={`${e.id}-${e.revision}`} className="space-y-4 rounded border p-5"><h2>{e.year} · {e.title}</h2>
      <form method="post" className="space-y-3" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget, f = new FormData(form);
        const iso = (name: string) => new Date(`${f.get(name)}:00+07:00`).toISOString();
        await send("/api/admin/schedule", { editionId: e.id, revision: e.revision, registrationOpensAt: iso("opens"), registrationClosesAt: iso("closes"), registrationManuallyClosed: f.get("closed") === "on", password: f.get("password") });
        (form.elements.namedItem("password") as HTMLInputElement).value = "";
      }}>
        <label>Начало регистрации<input className={field} name="opens" type="datetime-local" required defaultValue={local(e.registrationOpensAt)} /></label>
        <label>Окончание регистрации<input className={field} name="closes" type="datetime-local" required defaultValue={local(e.registrationClosesAt)} /></label>
        <label><input name="closed" type="checkbox" defaultChecked={e.registrationManuallyClosed} /> Закрыть вручную (снимите для возобновления по расписанию)</label>
        <label>Текущий пароль<input className={field} name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <Button disabled={busy || !hydrated}>Сохранить сроки</Button>
      </form>
      <h3>Главные организаторы</h3>{e.staffGrants.map(g => <p key={g.user.email}>{g.user.name} · {g.user.email}</p>)}
      <form method="post" className="space-y-3" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget, f = new FormData(form);
        await send("/api/admin/chief", { editionId: e.id, email: f.get("email"), name: f.get("name"), operation: f.get("operation"), password: f.get("password") });
        (form.elements.namedItem("password") as HTMLInputElement).value = "";
      }}>
        <label>Синтетическое имя<input className={field} name="name" required minLength={3} maxLength={200} /></label>
        <label>Email главного<input className={field} name="email" type="email" required /></label>
        <label>Операция<select className={field} name="operation"><option value="assign">Назначить</option><option value="replace">Заменить всех главных этого года</option><option value="revoke">Отозвать назначение этого аккаунта</option></select></label>
        <p>Отзыв сохраняет аккаунт, роль и историю, но удаляет сессии. Замена атомарно отзывает прежних главных выбранного года. Существующие студенты и организаторы площадок не повышаются.</p>
        <label>Текущий пароль<input className={field} name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <Button disabled={busy || !hydrated}>Выполнить операцию</Button>
      </form>
    </section>)}{message && <p role="status">{message}</p>}
  </div>;
}
