"use client";
let actor: string | undefined, generation=0;
// The rendered owner is an optimistic precondition, never an authentication source.
export function bindClientActor(userId:string){actor=userId;const current=++generation;return()=>{if(current===generation)actor=undefined;};}
export async function clientFetch(input:RequestInfo|URL, init:RequestInit={}) {
  const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  const target=new URL(url,window.location.href);
  const headers=new Headers(input instanceof Request?input.headers:undefined);
  new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
  if(actor&&target.origin===window.location.origin&&target.pathname.startsWith("/api/"))headers.set("X-SMO-Actor",actor);
  const limit=target.pathname==="/api/diplomas/upload"?420000:30000;
  const response=await fetch(input,{...init,headers,signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(limit)])});
  if(actor&&response.status===401&&target.pathname!=="/api/me")window.dispatchEvent(new Event("smo-session-changed"));
  if(response.status===409){try{if((await response.clone().json()).code==="SESSION_CHANGED")window.dispatchEvent(new Event("smo-session-changed"));}catch{ /* Original response is handled by the caller. */ }}
  return response;
}
