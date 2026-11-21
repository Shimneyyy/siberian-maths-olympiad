"use client";
import { clientFetch } from "@/lib/client-fetch";
import { useHydrated } from "@/lib/use-hydrated";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import type { teamsView } from "@/lib/teams";
export function TeamManager({ editions, enabled }: { editions: Awaited<ReturnType<typeof teamsView>>; enabled: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function act(data: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await clientFetch("/api/teams/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      setMessage(response.ok ? (data.operation === "invite" ? "Запрос обработан. Приглашение доступно участнику того же вуза и года, в том числе капитану другой команды. Письмо не отправляется." : "Изменения сохранены.") : result.error || "Действие недоступно");
      if (response.ok) router.refresh();
    } catch { setMessage("Не удалось получить ответ. Обновите страницу перед повтором."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6"><p>До трёх команд от вуза, до пяти участников включая капитана. Тренер — ФИО; капитан может указать себя.</p>
    <Button variant="outline" disabled={busy || !hydrated} onClick={() => router.refresh()}>Обновить команды и приглашения</Button>
    {!editions.length && <p>Сначала зарегистрируйте участие на год олимпиады.</p>}
    {editions.map(e => <section key={e.editionId} className="space-y-3 rounded border border-border p-5"><h2>{e.title} · {e.year}</h2>
      {!e.canChange && <p>Изменения команд закрыты для этого выпуска.</p>}
      {e.team ? <><h3>{e.team.name}</h3><p>Тренер: {e.team.coachName}</p><ul>{e.team.members.map(m => <li key={m.id}>{m.fullName}{m.id === e.team!.captainParticipationId ? " · капитан" : ""}</li>)}</ul></> : e.canChange && <form method="post" className="space-y-3" onSubmit={async event => {
        event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true); setMessage("");
        try {
          const response = await clientFetch("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId: e.editionId, coachName: f.get("coachName") }) });
          const result = await response.json(); setMessage(response.ok ? "Команда создана, вы её капитан и первый участник." : result.error || "Не удалось создать команду");
          if (response.ok) router.refresh();
        } catch { setMessage("Не удалось получить ответ. Обновите страницу перед повтором."); } finally { setBusy(false); }
      }}><label>ФИО тренера<input className="mt-2 block w-full rounded border p-2" name="coachName" required minLength={3} maxLength={200} /></label><Button disabled={busy || !enabled || !hydrated}>Создать команду</Button></form>}
      {e.invitations.length > 0 && e.team && <p>Чтобы принять приглашение, сначала выйдите из своей команды. Капитан может передать капитанство или удалить свою команду, сохранив участие в олимпиаде.</p>}
      {e.invitations.map(i => <div className="space-y-2 rounded border p-3" key={i.id}><p>Приглашение в {i.teamName}, капитан {i.captainName}</p><Button disabled={busy || !enabled || !hydrated || !e.canChange || !!e.team} onClick={() => void act({ editionId: e.editionId, operation: "acceptInvitation", invitationId: i.id, revision: i.revision })}>Принять приглашение</Button> <Button variant="outline" disabled={busy || !enabled || !hydrated || !e.canChange} onClick={() => void act({ editionId: e.editionId, operation: "declineInvitation", invitationId: i.id, revision: i.revision })}>Отклонить</Button></div>)}
      {e.team && e.canChange && <div className="space-y-4 border-t pt-4">
        {e.team.captainParticipationId === e.participationId ? <>
          <form method="post" className="space-y-3" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void act({ editionId: e.editionId, teamId: e.team!.id, operation: "invite", email: data.get("email") }); }}><label>Пригласить по точному email<input className="mt-2 block w-full rounded border p-2" name="email" type="email" required maxLength={254} /></label><Button disabled={busy || !enabled || !hydrated}>Пригласить в ЛК</Button></form>
          {e.team.invitations.map(i => <div key={i.id}><p>Ожидает ответа: {i.email}</p><Button variant="outline" disabled={busy || !enabled || !hydrated} onClick={() => void act({ editionId: e.editionId, teamId: e.team!.id, operation: "revokeInvitation", invitationId: i.id, revision: i.revision })}>Отозвать приглашение</Button></div>)}
          {e.team.members.filter(m => m.id !== e.participationId).map(m => <div className="flex flex-wrap gap-3" key={m.id}><span>{m.fullName}</span><Button variant="outline" disabled={busy || !enabled || !hydrated} onClick={() => void act({ editionId: e.editionId, teamId: e.team!.id, operation: "exclude", participationId: m.id })}>Исключить</Button><Button variant="outline" disabled={busy || !enabled || !hydrated} onClick={() => void act({ editionId: e.editionId, teamId: e.team!.id, operation: "requestCaptain", participationId: m.id })}>Предложить капитанство</Button></div>)}
          {e.team.transfer && <><p>Предложение капитанства ожидает подтверждения участником.</p><Button variant="outline" disabled={busy || !enabled || !hydrated} onClick={() => void act({ editionId: e.editionId, teamId: e.team!.id, operation: "cancelCaptain", revision: e.team!.transfer!.revision })}>Отозвать предложение</Button></>}
          <form method="post" className="space-y-3 rounded border p-3" onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void act({ editionId: e.editionId, teamId: e.team!.id, operation: "delete", confirmed: form.get("confirmed") === "on" });
          }}><p>Удаление распустит команду. Участие в олимпиаде у вас и остальных участников сохранится.</p>
            <label className="block"><input name="confirmed" type="checkbox" required /> Подтверждаю удаление команды</label>
            <Button variant="outline" disabled={busy || !enabled || !hydrated}>Удалить команду</Button>
          </form>
        </> : <Button variant="outline" disabled={busy || !enabled || !hydrated} onClick={() => void act({ editionId: e.editionId, teamId: e.team!.id, operation: "leave" })}>Выйти из команды</Button>}
        {e.team.transfer?.targetParticipationId === e.participationId && <div><p>Капитан предложил вам передать капитанство.</p><Button disabled={busy || !enabled || !hydrated} onClick={() => void act({ editionId: e.editionId, teamId: e.team!.id, operation: "acceptCaptain", revision: e.team!.transfer!.revision })}>Принять капитанство</Button> <Button variant="outline" disabled={busy || !enabled || !hydrated} onClick={() => void act({ editionId: e.editionId, teamId: e.team!.id, operation: "declineCaptain", revision: e.team!.transfer!.revision })}>Отклонить</Button></div>}
      </div>}
    </section>)}{message && <p role="status">{message}</p>}
  </div>;
}
