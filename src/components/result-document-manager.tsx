"use client";
import { useRef, useState, type FormEvent } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { ImportResponseError, readImportResponse } from "@/lib/import-response";
import { Button } from "./ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import type { resultDocuments } from "@/lib/result-documents";
type View=Awaited<ReturnType<typeof resultDocuments>>;
type Document=View["documents"][number];
const field="block w-full rounded border p-2";
function VersionEditor({document:doc,busy,send}:{document:Document;busy:boolean;send:(path:string,body:Record<string,unknown>)=>Promise<void>}){
 const attempts=useRef<Record<string,{content:string;id:string}>>({});
 const latest=doc.versions[0],needsOriginal=!!doc.sourceResultId&&!doc.currentVersionId;
 const values=latest.scores as (number|null)[];
 async function submit(event:FormEvent<HTMLFormElement>,path:string,body:Record<string,unknown>){
  event.preventDefault();const form=event.currentTarget,f=new FormData(form),content=JSON.stringify(body);
  if(attempts.current[path]?.content!==content)attempts.current[path]={content,id:crypto.randomUUID()};
  try{await send(path,{...body,id:attempts.current[path].id,editionId:doc.editionId,documentId:doc.id,revision:doc.revision,password:f.get("password"),confirmed:f.get("confirmed")==="on"});}
  finally{const p=form.elements.namedItem("password") as HTMLInputElement|null,c=form.elements.namedItem("confirmed") as HTMLInputElement|null;if(p)p.value="";if(c)c.checked=false;}
 }
 const proof=<><label className="block">Текущий пароль<input className={field} name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><label className="block"><input type="checkbox" name="confirmed" required/> Подтверждаю действие с этим результатом</label></>;
 return <section className="space-y-5 rounded border p-4"><h3>Версии: {doc.teamName??doc.recipients[0]?.fullName}</h3>
 <p>{doc.withdrawn?"Публикация отозвана":doc.currentVersionId?"Есть опубликованная версия":"Ещё не опубликован"}.</p>
 {needsOriginal&&<p>Сначала опубликуйте исходный пакет в разделе «Проверка сохранённых загрузок». После этого доступны исправления и отзыв.</p>}
 <ul>{doc.versions.map(v=><li key={v.id}>Версия {v.number}{doc.currentVersionId===v.id?doc.withdrawn?" — отозвана":" — опубликована":""}: сумма {v.total??"—"}. {v.reason&&<>Причина: {v.reason}</>}</li>)}</ul>
 <details><summary>История публикаций и отзывов</summary><ul>{doc.releases.map(r=><li key={r.id}>{new Date(r.createdAt).toLocaleString("ru-RU",{timeZone:"Asia/Novosibirsk"})} · {r.action==="PUBLISH"?"Публикация":"Отзыв"}{r.reason&&` · ${r.reason}`}</li>)}</ul></details>
 <form className="space-y-3" onSubmit={e=>{const f=new FormData(e.currentTarget);void submit(e,"amend",{scores:values.map((_,i)=>f.get(`score-${i}`)===""?null:Number(f.get(`score-${i}`))),total:f.get("total")===""?null:Number(f.get("total")),prize:f.get("prize")||null,reason:f.get("reason")});}}><fieldset disabled={busy||needsOriginal} className="space-y-3"><legend>Новая версия результата</legend>
 {values.map((value,i)=><label className="block" key={i}>Задача {i+1}<input className={field} name={`score-${i}`} type="number" min={0} max={2147483647} step={1} defaultValue={value??""}/></label>)}
 <label className="block">Сумма баллов<input className={field} name="total" type="number" min={0} max={2147483647} step={1} defaultValue={latest.total??""}/></label><label className="block">Приз<input className={field} name="prize" maxLength={200} defaultValue={latest.prize??""}/></label><label className="block">Причина исправления<textarea className={field} name="reason" required minLength={3} maxLength={2000}/></label>{proof}<Button>Сохранить новую версию</Button></fieldset></form>
 <form className="space-y-3" onSubmit={e=>void submit(e,"release",{action:"PUBLISH",versionId:latest.id})}><fieldset disabled={busy||needsOriginal||doc.currentVersionId===latest.id&&!doc.withdrawn} className="space-y-3"><legend>Отдельная публикация версии {latest.number}</legend>{proof}<Button>Опубликовать выбранную версию</Button></fieldset></form>
 {doc.currentVersionId&&!doc.withdrawn&&<form className="space-y-3" onSubmit={e=>{const f=new FormData(e.currentTarget);void submit(e,"release",{action:"REVOKE",versionId:doc.currentVersionId,reason:f.get("reason")});}}><fieldset disabled={busy} className="space-y-3"><legend>Отзыв текущей публикации</legend><label className="block">Причина отзыва<textarea className={field} name="reason" required minLength={3} maxLength={2000}/></label>{proof}<Button variant="outline">Отозвать публикацию результата</Button></fieldset></form>}
 </section>;
}
export function ResultDocumentManager({editions}:{editions:{id:string;year:number}[]}){
 const hydrated=useHydrated(),[editionId,setEdition]=useState(editions[0]?.id??""),[data,setData]=useState<View|null>(null),[selected,setSelected]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function api(path:string,body:unknown){return readImportResponse(await clientFetch(`/api/results/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"}),"Операция с результатами недоступна");}
 async function load(page=1){setBusy(true);setMessage("");try{setData(await api("documents",{editionId,page}));}catch(e){setData(null);setSelected(null);setMessage(e instanceof Error?e.message:"Ошибка загрузки");}finally{setBusy(false);}}
 async function send(path:string,body:Record<string,unknown>){setBusy(true);setMessage("");try{await api(path,body);setData(await api("documents",{editionId,page:data?.page??1}));setMessage(path==="amend"?"Новая версия сохранена. Опубликуйте её отдельно.":"Публикация изменена. Уведомления поставлены в очередь.");}catch(e){if(e instanceof ImportResponseError){if([401,403,409].includes(e.status)){setData(null);setSelected(null);}setMessage(e.message);}else setMessage("Ответ не получен. Повторите эту же форму: идентификатор попытки сохранён.");}finally{setBusy(false);}}
 const doc=data?.documents.find(d=>d.id===selected);
 return <section className="space-y-5 border-t pt-6"><h2 className="text-2xl">Версии и отзыв результатов</h2><label className="block">Год управления результатами<select className={field} disabled={busy} value={editionId} onChange={e=>{setEdition(e.target.value);setData(null);setSelected(null);setMessage("");}}>{editions.map(e=><option key={e.id} value={e.id}>{e.year}</option>)}</select></label><Button disabled={!hydrated||busy||!editionId} onClick={()=>void load()}>Показать результаты для исправления</Button>
 {data&&<><p>Результатов: {data.total}. Страница {data.page}.</p>{data.documents.map(d=><article key={d.id} className="rounded border p-3"><p>{d.teamName??d.recipients[0]?.fullName} · {d.kind==="FINAL"?"Итоговые":"Предварительные"} · {d.teamKey?"Командный":"Личный"}</p><Button disabled={busy} onClick={()=>setSelected(d.id)}>Управлять результатом</Button></article>)}<Button disabled={busy||data.page===1} onClick={()=>void load(data.page-1)}>Предыдущие результаты</Button><Button disabled={busy||data.page*25>=data.total} onClick={()=>void load(data.page+1)}>Следующие результаты</Button></>}
 {doc&&<VersionEditor key={`${doc.id}:${doc.revision}`} document={doc} busy={busy} send={send}/>}{message&&<p role="status">{message}</p>}</section>;
}
