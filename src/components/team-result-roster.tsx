"use client";
import { useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
import { Button } from "./ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import type { teamResultRoster } from "@/lib/team-results";
type Roster=Awaited<ReturnType<typeof teamResultRoster>>;
export function TeamResultRoster({editions}:{editions:{id:string;year:number}[]}){
 const hydrated=useHydrated(),[editionId,setEdition]=useState(editions[0]?.id??""),[data,setData]=useState<Roster|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function load(page=1){setBusy(true);setData(null);setMessage("");try{const r=await clientFetch("/api/results/teams/roster",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({editionId,page}),cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Список команд недоступен");setData(d);}catch(e){setMessage(e instanceof Error?e.message:"Не удалось получить список");}finally{setBusy(false);}}
 return <section className="space-y-4 border-t pt-5"><h2>Состав команд</h2><label className="block">Год списка команд<select className="mt-1 block rounded border border-border p-2" disabled={busy} value={editionId} onChange={e=>{setEdition(e.target.value);setData(null);setMessage("");}}>{editions.map(e=><option key={e.id} value={e.id}>{e.year}</option>)}</select></label><Button disabled={!hydrated||busy||!editionId} onClick={()=>void load()}>Показать команды для CSV</Button>
 {data&&<><div className="overflow-auto"><table className="result-table w-full text-left"><caption className="sr-only">Команды и логины участников</caption><thead><tr><th>Название</th><th>Участники, курсы и вузы</th></tr></thead><tbody>{data.teams.map(t=><tr key={t.id}><td>{t.name}</td><td><ul>{t.members.map((m,i)=><li key={i}>{m.participation.fullName} · {m.participation.courseLabel} · <code>{m.login ?? "—"}</code></li>)}</ul></td></tr>)}</tbody></table></div><Button disabled={busy||data.page===1} onClick={()=>void load(data.page-1)}>Предыдущие команды</Button><Button disabled={busy||data.page*25>=data.total} onClick={()=>void load(data.page+1)}>Следующие команды</Button></>}{message&&<p role="status">{message}</p>}</section>;
}
