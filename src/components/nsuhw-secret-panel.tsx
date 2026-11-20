"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useEffect,useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
type Secret={login:string;password:string};
export function NsuhwSecretPanel(){
 const hydrated=useHydrated(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [metadata,setMetadata]=useState<{login:string;confirmedAt:string|null}|null>(null),[loaded,setLoaded]=useState(false),[secret,setSecret]=useState<Secret|null>(null);
 useEffect(()=>{const hide=()=>setSecret(null),visibility=()=>{if(document.hidden)hide();};document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",hide);window.addEventListener("blur",hide);return()=>{document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",hide);window.removeEventListener("blur",hide);};},[]);
 useEffect(()=>{if(!secret)return;const timer=setTimeout(()=>setSecret(null),60000);return()=>clearTimeout(timer);},[secret]);
 return <section className="space-y-3 rounded border p-4"><h2>Пароль nsuhw</h2><p>Это отдельный пароль внешнего сайта, он не меняет пароль ЛК. Доступен только после подтверждения создания аккаунта главным. Для каждого показа заново введите текущий пароль ЛК.</p>
 <Button disabled={!hydrated||busy} onClick={async()=>{setBusy(true);setMessage("");setSecret(null);try{const r=await clientFetch("/api/nsuhw/prepared",{cache:"no-store"});if(!r.ok)throw new Error("Не удалось проверить статус");setMetadata(await r.json());setLoaded(true);}catch(e){setLoaded(false);setMetadata(null);setMessage(e instanceof Error?e.message:"Ошибка");}finally{setBusy(false);}}}>Проверить готовность аккаунта nsuhw</Button>
 {loaded&&!metadata&&<p>Новые данные nsuhw ещё не подготовлены.</p>}
 {metadata&&!metadata.confirmedAt&&<p>Логин {metadata.login} подготовлен в ЛК. Ожидается подтверждение успешного создания на nsuhw; пароль пока не выдаётся.</p>}
 {metadata?.confirmedAt&&<><p>Главный организатор подтвердил создание аккаунта {metadata.login}.</p><form method="post" className="space-y-3" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget),form=e.currentTarget;setBusy(true);setMessage("");setSecret(null);try{const r=await clientFetch("/api/nsuhw/secret",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:f.get("password"),confirmed:f.get("confirmed")==="on"})});const data=await r.json();if(!r.ok)throw new Error(data.error||"Пароль временно недоступен");form.reset();if(!document.hidden&&document.hasFocus())setSecret(data);else setMessage("Показ скрыт после ухода со вкладки. Запросите его повторно при необходимости.");}catch(e){setMessage(e instanceof Error?e.message:"Повторите позже");}finally{setBusy(false);}}}>
 <label className="block">Текущий пароль ЛК для показа nsuhw<input className="block w-full rounded border p-2" name="password" type="password" required autoComplete="current-password" maxLength={128}/></label>
 <label className="block"><input name="confirmed" type="checkbox" required/>Подтверждаю показ моего пароля nsuhw</label><Button disabled={!hydrated||busy}>Показать мой пароль nsuhw</Button>
 </form></>}
 {secret&&<div className="space-y-2 rounded border p-3" aria-label="Мои данные nsuhw"><p>Логин: {secret.login}</p><p>Пароль nsuhw: <code>{secret.password}</code></p><p>Пароль скроется через минуту или при уходе со вкладки. Повторный показ требует новой проверки пароля ЛК.</p><Button variant="outline" onClick={()=>setSecret(null)}>Скрыть пароль nsuhw</Button></div>}
 {message&&<p role="status">{message}</p>}</section>;
}
