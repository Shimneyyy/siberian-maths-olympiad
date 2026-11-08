"use client";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { NsuhwLoginNamesEditor } from "./nsuhw-login-names-editor";
import { Button } from "@/components/ui/button";
type Claim = {id:string;login:string;revision:number;approvedAt:string|null;userId?:string;participationId?:string;fullName?:string};
export function LegacyNsuhwManager({chief,editions}:{chief:boolean;editions:{id:string;year:number}[]}) {
  const hydrated = useHydrated();
  const [editionId,setEdition] = useState(editions[0]?.id??""), [claims,setClaims] = useState<Claim[]>([]);
  const [busy,setBusy] = useState(false),[loaded,setLoaded] = useState(false),[message,setMessage] = useState("");
  async function api(path:string,body?:unknown) {
    const r=await fetch(`/api/nsuhw/legacy${path}`,{method:body===undefined?"GET":"POST",headers:body===undefined?{}:{"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await r.json();if(!r.ok)throw new Error(result.error||"Повторите позже");return result;
  }
  async function load(){const result=await api(chief?"/review":"",chief?{editionId}:undefined);setClaims(chief?result:result?[result]:[]);setLoaded(true);}
  async function action(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn();}catch(e){setClaims([]);setLoaded(false);setMessage(e instanceof Error?e.message:"Ошибка");}finally{setBusy(false);}}
  return <section className="space-y-4">
    {chief?<><label>Год<select value={editionId} disabled={busy} onChange={e=>{setEdition(e.target.value);setClaims([]);setLoaded(false);}}>{editions.map(e=><option key={e.id} value={e.id}>{e.year}</option>)}</select></label><p>Сверьте заявку с ответственным за nsuhw вне сайта. ФИО и знание логина сами по себе не доказывают владение. Здесь видны только участники назначенного вам года с подтверждённым email.</p></>:<p>Если аккаунт nsuhw уже был, укажите его логин. Главный проверит связь после вашей регистрации на год. Пока заявка ожидает проверки, новые данные не генерируются.</p>}
    <Button disabled={!hydrated||busy||(chief&&!editionId)} onClick={()=>action(load)}>{chief?"Показать заявки":"Проверить мою заявку"}</Button>
    {!chief&&loaded&&!claims.length&&<NsuhwLoginNamesEditor/>}
    {!chief&&loaded&&!claims.length&&<form method="post" className="space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action(async()=>{await api("",{login:f.get("login"),confirmed:f.get("confirmed")==="on"});await load();setMessage("Заявка ожидает проверки главного организатора");});}}>
      <label className="block">Старый логин nsuhw<input className="block w-full rounded border p-2" name="login" required maxLength={254} autoComplete="off" /></label><label><input type="checkbox" name="confirmed" required />Прошу проверить принадлежность старого аккаунта</label><Button disabled={!hydrated||busy}>Отправить на проверку</Button>
    </form>}
    {claims.map(c=><article key={c.id} className="space-y-3 rounded border p-4">{chief&&<><p>{c.fullName}</p><p>ID участника: {c.userId}</p></>}<p>Логин nsuhw: {c.login}</p><p>{c.approvedAt?"Привязка подтверждена главным организатором":"Ожидает проверки. Это ещё не подтверждённая привязка"}</p>
      {chief&&!c.approvedAt&&<form method="post" className="space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action(async()=>{await api("/approve",{editionId,claimId:c.id,revision:c.revision,password:f.get("password"),confirmed:f.get("confirmed")==="on",ownershipChecked:f.get("ownershipChecked")==="on"});await load();setMessage("Привязка подтверждена");});}}><label className="block">Текущий пароль<input className="block w-full rounded border p-2" name="password" type="password" required autoComplete="current-password" maxLength={128}/></label><label className="block"><input name="ownershipChecked" type="checkbox" required/>Сверил принадлежность аккаунта с ответственным за nsuhw</label><label className="block"><input name="confirmed" type="checkbox" required/>Подтверждаю привязку указанного логина к этому участнику</label><Button disabled={!hydrated||busy}>Подтвердить привязку</Button></form>}
    </article>)}
    {message&&<p role="status">{message}</p>}
    {!chief&&claims.length>0&&<p>Новый аккаунт nsuhw взамен не создаётся. Для исправления ошибочно указанного логина обратитесь к главному; изменение/отзыв привязки через сайт пока не предусмотрены.</p>}
  </section>;
}
