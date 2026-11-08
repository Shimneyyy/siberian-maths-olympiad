"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import { nsuhwLoginPreview } from "@/lib/nsuhw-login-name-rules";
export function NsuhwLoginNamesEditor(){
 const hydrated=useHydrated(),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [firstNameLatin,setFirst]=useState(""),[lastNameLatin,setLast]=useState(""),[revision,setRevision]=useState(0);
 const preview=nsuhwLoginPreview({firstNameLatin,lastNameLatin});
 return <section className="space-y-3 rounded border p-4"><h2>Имя и фамилия для нового логина nsuhw</h2><p>Эти поля не меняют ФИО, профиль и снимки заявок. Введите только буквы A–Z, без пробелов и знаков; написание выберите самостоятельно. Генерация аккаунтов пока не включена.</p>
 <Button disabled={!hydrated||busy} onClick={async()=>{setBusy(true);setMessage("");try{const r=await fetch("/api/nsuhw/login-names");if(!r.ok)throw new Error("Не удалось загрузить данные");const d=await r.json();setFirst(d?.firstNameLatin??"");setLast(d?.lastNameLatin??"");setRevision(d?.revision??0);setLoaded(true);}catch(e){setLoaded(false);setMessage(e instanceof Error?e.message:"Ошибка");}finally{setBusy(false);}}}>Загрузить данные для нового логина</Button>
 {loaded&&<form method="post" className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage("");try{const r=await fetch("/api/nsuhw/login-names",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({firstNameLatin,lastNameLatin,revision})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Ошибка сохранения");setRevision(d.revision);setMessage("Данные для логина сохранены. ФИО заявки не изменено.");}catch(e){setMessage(e instanceof Error?e.message:"Ошибка");}finally{setBusy(false);}}}>
 <label className="block">Имя латиницей для логина<input className="block w-full rounded border p-2" name="firstNameLatin" required pattern="[A-Za-z]+" maxLength={80} autoComplete="off" value={firstNameLatin} onChange={e=>setFirst(e.target.value)}/></label>
 <label className="block">Фамилия латиницей для логина<input className="block w-full rounded border p-2" name="lastNameLatin" required pattern="[A-Za-z]+" maxLength={80} autoComplete="off" value={lastNameLatin} onChange={e=>setLast(e.target.value)}/></label>
 <p>{preview?`Предварительный логин: ${preview}`:"Введите имя и фамилию латиницей"}</p><p>Логин ещё не выдан. При совпадении сервер добавит индекс 2, 3 и далее.</p><Button disabled={!hydrated||busy}>Сохранить данные для логина</Button>
 </form>}{message&&<p role="status">{message}</p>}</section>;
}
