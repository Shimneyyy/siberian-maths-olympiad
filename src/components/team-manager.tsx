"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import type { teamsView } from "@/lib/teams";
export function TeamManager({ editions, enabled }: { editions: Awaited<ReturnType<typeof teamsView>>; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <div className="space-y-6"><p>До трёх команд от вуза, до пяти участников включая капитана. Тренер — ФИО; капитан может указать себя. Только синтетические данные.</p>
    {!editions.length && <p>Сначала зарегистрируйте участие на год олимпиады.</p>}
    {editions.map(e => <section key={e.editionId} className="space-y-3 rounded border border-border p-5"><h2>{e.title} · {e.year}</h2>
      {!e.canChange && <p>Изменения команд закрыты для этого выпуска.</p>}
      {e.team ? <><h3>{e.team.name}</h3><p>Тренер: {e.team.coachName}</p><ul>{e.team.members.map(m => <li key={m.id}>{m.fullName}{m.id === e.team!.captainParticipationId ? " · капитан" : ""}</li>)}</ul></> : e.canChange && <form className="space-y-3" onSubmit={async event => {
        event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); setMessage("");
        try {
          const response = await fetch("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId: e.editionId, coachName: f.get("coachName") }) });
          const result = await response.json(); setMessage(response.ok ? "Команда создана, вы её капитан и первый участник." : result.error || "Не удалось создать команду");
          if (response.ok) router.refresh();
        } catch { setMessage("Не удалось получить ответ. Обновите страницу перед повтором."); } finally { setBusy(false); }
      }}><label>ФИО тренера<input className="mt-2 block w-full rounded border p-2" name="coachName" required minLength={3} maxLength={200} /></label><Button disabled={busy || !enabled}>Создать команду</Button></form>}
    </section>)}{message && <p role="status">{message}</p>}
  </div>;
}
