"use client";
export async function clientFetch(input:RequestInfo|URL, init:RequestInit={}) {
  const url=typeof input==="string"?input:input instanceof URL?input.pathname:input.url;
  const limit=url.includes("/api/diplomas/upload")?420000:30000;
  return fetch(input,{...init,signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(limit)])});
}
