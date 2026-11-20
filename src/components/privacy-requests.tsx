"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
export function PrivacyRequests() {
  const hydrated = useHydrated(), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [id, setId] = useState("");
  return <form method="post" className="space-y-4" onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget; setBusy(true); setMessage(""); const requestId = id || crypto.randomUUID(); setId(requestId);
    try { const response = await clientFetch("/api/privacy/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: requestId, confirmed: new FormData(form).get("confirmed") === "on" }), cache: "no-store" }); if (!response.ok) throw new Error("Не удалось зарегистрировать обращение"); setMessage("Обращение зарегистрировано для ручного рассмотрения оператором. Автоматическое удаление данных не выполняется."); form.reset(); } catch (error) { setMessage(error instanceof Error ? error.message : "Повторите позже"); } finally { setBusy(false); }
  }}><label className="block"><input type="checkbox" name="confirmed" required disabled={busy} /> Прошу зарегистрировать обращение об отзыве согласия для ручного рассмотрения</label><Button disabled={!hydrated || busy}>Зарегистрировать обращение</Button>{message && <p role="status">{message}</p>}</form>;
}
