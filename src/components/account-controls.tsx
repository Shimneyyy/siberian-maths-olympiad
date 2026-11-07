"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
export function AccountControls({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <section className="mt-8 space-y-4 rounded-xl border border-border bg-white p-6">
    <h2 className="text-xl font-semibold">Безопасность аккаунта</h2>
    <p>{enabled ? "Двухфакторная аутентификация включена." : "Для работы организатором включите двухфакторную аутентификацию."}</p>
    {!enabled && !setup && <form method="post" className="space-y-3" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); const form = event.currentTarget;
      try {
        const result = await authClient.twoFactor.enable({ password: String(new FormData(form).get("password")) });
        if (result.error || !result.data) { setMessage("Не удалось начать настройку. Проверьте пароль."); return; }
        form.reset(); if ("totpURI" in result.data) setSetup(result.data); setMessage("");
      } catch { setMessage("Повторите позже."); } finally { setBusy(false); }
    }}>
      <label className="block">Текущий пароль<input name="password" type="password" autoComplete="current-password" required className="mt-2 block rounded-lg border border-border px-3 py-2" /></label>
      <Button disabled={busy}>Настроить TOTP</Button>
    </form>}
    {setup && <div className="space-y-4">
      <p>Добавьте этот адрес в приложение-аутентификатор. Он содержит секрет — никому его не передавайте.</p>
      <code className="block break-all rounded-lg bg-muted p-3 text-sm">{setup.totpURI}</code>
      <p>Сохраните резервные коды в защищённом месте:</p><pre className="rounded-lg bg-muted p-3">{setup.backupCodes.join("\n")}</pre>
      <form method="post" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true);
        try { const result = await authClient.twoFactor.verifyTotp({ code: String(new FormData(event.currentTarget).get("code")), trustDevice: false });
          if (result.error) setMessage("Проверьте код."); else { setSetup(null); router.refresh(); }
        } catch { setMessage("Повторите позже."); } finally { setBusy(false); }
      }} className="space-y-3"><label className="block">Код приложения<input name="code" required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" className="mt-2 block rounded-lg border border-border px-3 py-2" /></label><Button disabled={busy}>Подтвердить настройку</Button></form>
    </div>}
    {message && <p role="status">{message}</p>}
    <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const result = await authClient.signOut(); if (result.error) setMessage("Не удалось выйти."); else { router.refresh(); router.push("/login"); } } catch { setMessage("Повторите позже."); } finally { setBusy(false); } }}>Выйти</Button>
  </section>;
}
