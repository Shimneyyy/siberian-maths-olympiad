"use client";
import { useEffect,useState } from "react";
import { clientFetch,bindClientActor } from "@/lib/client-fetch";
export function PrivateSessionBoundary({userId,children}:{userId:string;children:React.ReactNode}) {
 const [checking,setChecking]=useState(false);
 useEffect(()=>{
  const unbind=bindClientActor(userId);let active=true, revision=0, mustReload=false;
  const changed=()=>{setChecking(true);window.location.replace("/cabinet");};
  const verify=async(reload:boolean)=>{
   mustReload ||= reload;const current=++revision;if(mustReload)setChecking(true);
   try{const response=await clientFetch("/api/me",{cache:"no-store"});const body=await response.json();if(!active||current!==revision)return;
    if(!response.ok){setChecking(true);window.location.replace("/login");return;}
    if(body.user?.id!==userId){changed();return;}
    if(mustReload)window.location.reload();else setChecking(false);
   }catch{if(active&&current===revision){mustReload=true;setChecking(true);}}
  };
  const show=(event:PageTransitionEvent)=>{if(event.persisted)void verify(true);};
  const hide=()=>setChecking(true),pop=()=>void verify(true),focus=()=>void verify(false);
  window.addEventListener("pageshow",show);window.addEventListener("pagehide",hide);window.addEventListener("popstate",pop);window.addEventListener("focus",focus);window.addEventListener("smo-session-changed",changed);
  return()=>{active=false;unbind();window.removeEventListener("pageshow",show);window.removeEventListener("pagehide",hide);window.removeEventListener("popstate",pop);window.removeEventListener("focus",focus);window.removeEventListener("smo-session-changed",changed);};
 },[userId]);
 return <>{checking&&<p role="status" className="p-6">Проверка доступа… При отсутствии связи обновите страницу.</p>}<div hidden={checking}>{children}</div></>;
}
