"use client";
import { useEffect,useState } from "react";
import { clientFetch } from "@/lib/client-fetch";
export function PrivateSessionBoundary({userId,children}:{userId:string;children:React.ReactNode}) {
 const [checking,setChecking]=useState(false);
 useEffect(()=>{
  let active=true, revision=0;
  const verify=async()=>{const current=++revision;setChecking(true);try{const response=await clientFetch("/api/me",{cache:"no-store"});const body=await response.json();if(!active||current!==revision)return;if(!response.ok||body.user?.id!==userId){window.location.replace("/login");return;}window.location.reload();}catch{if(active&&current===revision)setChecking(true);}};
  const show=(event:PageTransitionEvent)=>{if(event.persisted)void verify();};
  const hide=()=>setChecking(true);
  const pop=()=>void verify();
  window.addEventListener("pageshow",show);window.addEventListener("pagehide",hide);window.addEventListener("popstate",pop);
  return()=>{active=false;window.removeEventListener("pageshow",show);window.removeEventListener("pagehide",hide);window.removeEventListener("popstate",pop);};
 },[userId]);
 return <>{checking&&<p role="status" className="p-6">Проверка доступа… При отсутствии связи обновите страницу.</p>}<div hidden={checking}>{children}</div></>;
}
