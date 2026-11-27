"use client";
import { useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "./ui/button";
import type { catalogsView } from "@/lib/catalogs";
type View=Awaited<ReturnType<typeof catalogsView>>;
export function CatalogManager({editions}:{editions:{id:string;year:number}[]}) {
 const hydrated=useHydrated(),[editionId,setEdition]=useState(editions[0]?.id||""),[data,setData]=useState<View|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function load(){const r=await clientFetch(`/api/catalogs?editionId=${editionId}`,{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Ошибка загрузки");setData(d);}
 async function action(run:()=>Promise<void>){setBusy(true);setMessage("");try{await run();}catch(e){setMessage(e instanceof Error?e.message:"Ошибка");}finally{setBusy(false);}}
 function form(kind:"university"|"course",item?:{id:string;name?:string;label?:string;abbreviation?:string;revision:number;active:boolean}) {
 return <form key={item? `${item.id}:${item.revision}` : `new:${kind}`} method="post" className="space-y-3 rounded border p-4" onSubmit={event => {
  event.preventDefault();
  const element = event.currentTarget, fields = new FormData(element);
  const removing = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "delete";
  if (removing && (!item || !window.confirm(`Удалить «${item.name ?? item.label}»?`))) return;
  const credentials = { editionId, kind, password: fields.get("password"), ...(item ? { id: item.id, revision: item.revision } : {}) };
  const body = removing ? credentials : {
    ...credentials, name: fields.get("name"), ...(kind === "university" ? { abbreviation: fields.get("abbreviation") } : {}),
    active: fields.get("active") === "on",
  };
  void action(async () => {
    try {
      const response = await clientFetch("/api/catalogs", { method: removing ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить справочник");
      if (!item) element.reset();
      await load();
      setMessage(removing ? "Запись удалена." : "Запись сохранена.");
    } finally {
      (element.elements.namedItem("password") as HTMLInputElement).value = "";
    }
  });
 }}><h3>{item ? "Изменить запись" : kind === "university" ? "Добавить вуз" : "Добавить курс"}</h3>
 <label className="block">Название<input className="block w-full rounded border p-2" name="name" required maxLength={200} defaultValue={item?.name??item?.label??""}/></label>
 {kind==="university"&&<label className="block">Аббревиатура<input className="block w-full rounded border p-2" name="abbreviation" required maxLength={30} defaultValue={item?.abbreviation??""}/></label>}
 <label className="block"><input type="checkbox" name="active" defaultChecked={item?.active??true}/> Доступно для новых регистраций</label>
 <label className="block">Текущий пароль<input className="block w-full rounded border p-2" name="password" type="password" required autoComplete="current-password" maxLength={128}/></label><div className="flex flex-wrap gap-3"><Button disabled={!hydrated||busy||!editionId}>Сохранить запись</Button>{item && <Button type="submit" value="delete" variant="outline" disabled={!hydrated||busy||!editionId}>Удалить</Button>}</div></form>;
 }
 return <section className="space-y-5">
 <label className="block">Год назначения<select className="block rounded border p-2" disabled={busy} value={editionId} onChange={e=>{setEdition(e.target.value);setData(null);}}>{editions.map(e=><option key={e.id} value={e.id}>{e.year}</option>)}</select></label>
 <Button disabled={!hydrated||busy||!editionId} onClick={()=>void action(load)}>Показать справочники</Button>
 {data&&<><h2>Вузы</h2>{form("university")}{data.universities.map(item=>form("university",item))}<h2>Курсы</h2>{form("course")}{data.courses.map(item=>form("course",item))}</>}
 {message&&<p role="status">{message}</p>}</section>;
}
