"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
export function TransferForm({ view }: { view: { editionId: string; participationId: string; fullName: string; revision: number; venues: { id: string; name: string }[] } }) {
  const hydrated = useHydrated();
  const [busy,setBusy] = useState(false), [done,setDone] = useState(false), [message,setMessage] = useState("");
  return <form method="post" className="space-y-4" onSubmit={async e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setMessage("");
    try {
      const response = await clientFetch("/api/participations/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId: view.editionId, participationId: view.participationId, revision: view.revision, editionVenueId: form.get("venue"), reason: form.get("reason"), password: form.get("password"), confirmed: form.get("confirmed") === "on" }) });
      const result = await response.json(); if(!response.ok) throw new Error(result.error || "Перенос недоступен");
      setDone(true); setMessage("Площадка изменена. Уведомление поставлено в очередь.");
    } catch(e) { setMessage(e instanceof Error ? e.message : "Повторите позже"); } finally { setBusy(false); }
  }}><p>{view.fullName}</p><p>Меняется только очная площадка текущей заявки. Формат, вуз, команда, явка и остальные годы сохраняются.</p>
    <label className="block">Новая очная площадка<select className="block w-full rounded border p-2" name="venue" required defaultValue=""><option value="" disabled>Выберите площадку</option>{view.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
    <label className="block">Причина переноса (без ПДн и секретов)<textarea className="block w-full rounded border p-2" name="reason" required maxLength={1000} /></label>
    <label className="block">Текущий пароль<input className="block w-full rounded border p-2" name="password" type="password" required autoComplete="current-password" /></label>
    <label><input type="checkbox" name="confirmed" required /> Подтверждаю перенос и уведомление участника</label>
    <Button disabled={!hydrated || busy || done || !view.venues.length}>Перенести на площадку</Button>
    {message && <p role="status">{message}</p>}
  </form>;
}
