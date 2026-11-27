"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { NsuhwSecretPanel } from "./nsuhw-secret-panel";
import { NsuhwLoginNamesEditor } from "./nsuhw-login-names-editor";
import { Button } from "@/components/ui/button";
type Login = { id: string; login: string; revision: number };
export function LegacyNsuhwManager() {
  const hydrated = useHydrated();
  const [login, setLogin] = useState<Login | null>(null), [hasPrepared, setHasPrepared] = useState(false);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [message, setMessage] = useState("");
  async function api(body?: unknown, method = "POST") {
    const response = await clientFetch("/api/nsuhw/legacy", { method: body === undefined ? "GET" : method, cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Повторите позже");
    return result;
  }
  async function load() {
    const own = await api();
    const response = await clientFetch("/api/nsuhw/prepared", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить данные аккаунта");
    const prepared = await response.json();
    setLogin(own); setHasPrepared(!!prepared); setLoaded(true);
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await fn(); } catch (error) { setLogin(null); setLoaded(false); setMessage(error instanceof Error ? error.message : "Ошибка"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4">
    <Button disabled={!hydrated || busy} onClick={() => void action(load)}>Показать мой аккаунт nsuhw</Button>
    {loaded && login && <article className="space-y-3 rounded border p-4"><dl><dt className="text-sm text-slate-600">Логин nsuhw</dt><dd className="break-all font-mono text-xl font-semibold text-primary">{login.login}</dd></dl></article>}
    {loaded && login && <form key={`${login.id}:${login.revision}`} method="post" className="space-y-3" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action(async () => { await api({login:form.get("login"),revision:login.revision}, "PATCH"); await load(); setMessage("Логин сохранён."); });
    }}><label className="block">Исправить старый логин nsuhw<input className="block w-full rounded border p-2" name="login" required maxLength={254} defaultValue={login.login} autoComplete="off" disabled={busy}/></label><Button disabled={!hydrated || busy}>Исправить логин</Button></form>}
    {loaded && !login && <><NsuhwLoginNamesEditor onPrepared={() => setHasPrepared(true)} /><NsuhwSecretPanel /></>}
    {loaded && !login && !hasPrepared && <form method="post" className="space-y-3" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action(async () => { await api({ login: form.get("login") }); await load(); setMessage("Старый логин сохранён."); });
    }}><label className="block">Старый логин nsuhw<input className="block w-full rounded border p-2" name="login" required maxLength={254} autoComplete="off" /></label><Button disabled={!hydrated || busy}>Сохранить старый логин</Button></form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
