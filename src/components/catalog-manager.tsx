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
 async function action(run:()=>Promise<void>){setBusy(true);setMessage("");try{await run();}catch(e){setData(null);setMessage(e instanceof Error?e.message:"Ошибка");}finally{setBusy(false);}}
 function form(kind:"university"|"course",item?:{id:string;name?:string;label?:string;abbreviation?:string;revision:number;active:boolean}) {
 return <form key={item?`${item.id}:${item.revision}`:`new:${kind}`} className="space-y-3 rounded border p-4" onSubmit={e=>{
  e.preventDefault();const f=new FormData(e.currentTarget),element=e.currentTarget;
  void action(async()=>{try{const r=await clientFetch("/api/catalogs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({editionId,kind,...(item?{id:item.id,revision:item.revision}:{}),name:f.get("name"),...(kind==="university"?{abbreviation:f.get("abbreviation")} :{}),active:f.get("active")==="on",password:f.get("password")})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Ошибка записи");await load();setMessage("Справочник сохранён. Исторические заявки не изменены.");}finally{(element.elements.namedItem("password") as HTMLInputElement).value="";}});
 }}><h3>{item?"Изменить запись":kind==="university"?"Добавить вуз":"Добавить курс"}</h3>
 <label className="block">Название<input className="block w-full rounded border p-2" name="name" required maxLength={200} defaultValue={item?.name??item?.label??""}/></label>
 {kind==="university"&&<label className="block">Аббревиатура<input className="block w-full rounded border p-2" name="abbreviation" required maxLength={30} defaultValue={item?.abbreviation??""}/></label>}
 <label className="block"><input type="checkbox" name="active" defaultChecked={item?.active??true}/> Доступно для новых регистраций</label>
 <label className="block">Текущий пароль<input className="block w-full rounded border p-2" name="password" type="password" required autoComplete="current-password" maxLength={128}/></label><Button disabled={!hydrated||busy||!editionId}>Сохранить запись</Button></form>;
 }
 return <section className="space-y-5"><p>Общие справочники всех годов. Отключение скрывает вариант для новых выборов; прежние заявки и снимки сохраняются. Физического удаления нет.</p>
 <label className="block">Год назначения<select className="block rounded border p-2" disabled={busy} value={editionId} onChange={e=>{setEdition(e.target.value);setData(null);}}>{editions.map(e=><option key={e.id} value={e.id}>{e.year}</option>)}</select></label>
 <Button disabled={!hydrated||busy||!editionId} onClick={()=>void action(load)}>Показать справочники</Button>
 {data&&<><h2>Вузы</h2>{form("university")}{data.universities.map(item=>form("university",item))}<h2>Курсы</h2>{form("course")}{data.courses.map(item=>form("course",item))}</>}
 {message&&<p role="status">{message}</p>}</section>;
}
