"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { nsuhwLoginPreview } from "@/lib/nsuhw-login-name-rules";
import { Button } from "@/components/ui/button";

type Choice = { id: string; label: string };
type Mode = "login" | "register" | "verify" | "forgot" | "reset" | "two-factor";
export function AuthForm({ mode: initialMode, universities = [], courses = [], resetToken = "" }:
 { mode: Mode; universities?: Choice[]; courses?: Choice[]; resetToken?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasLegacy, setHasLegacy] = useState(false);
  const [firstNameLatin,setFirstNameLatin] = useState(""), [lastNameLatin,setLastNameLatin] = useState("");
  const preview=nsuhwLoginPreview({firstNameLatin,lastNameLatin});
  const [email, setEmail] = useState("");
  const titles = { login: "Вход в личный кабинет", register: "Учебная регистрация", verify: "Подтверждение email", forgot: "Восстановление доступа", reset: "Новый пароль", "two-factor": "Подтверждение входа" };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    const value = String(data.get("code") || "");
    try {
      if (mode === "register") {
        const response = await fetch("/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          ...(hasLegacy ? { legacyNsuhwLogin: data.get("legacyLogin"), legacyNsuhwClaimConfirmed: data.get("legacyConfirmed") === "on" } : {firstNameLatin,lastNameLatin}),
          name: data.get("name"), email, password, universityId: data.get("universityId"), courseId: data.get("courseId"), demoConsent: data.get("demoConsent") === "on",
        }) });
        if (!response.ok) throw new Error("Проверьте поля. Регистрация доступна только в учебном режиме с email @example.test.");
        router.refresh(); router.push("/verify"); return;
      }
      if (mode === "login") {
        const result = await authClient.signIn.email({ email, password });
        if (result.error?.code === "EMAIL_NOT_VERIFIED") {
          const sent = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
          setMode("verify");
          setMessage(sent.error ? "Не удалось отправить код. Повторите отправку ниже." : "Для входа подтвердите email кодом из письма. Смена пароля сама по себе не подтверждает email.");
          return;
        }
        if (result.error) throw new Error("Не удалось войти. Проверьте данные и подтверждение email.");
        router.refresh(); router.push(result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect ? "/two-factor" : "/cabinet"); return;
      }
      if (mode === "verify") {
        const result = await authClient.emailOtp.verifyEmail({ email, otp: value });
        if (result.error) throw new Error("Код неверен или истёк.");
        router.refresh(); router.push("/login"); return;
      }
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        if (result.error) throw new Error("Не удалось отправить запрос. Повторите позже.");
        setMessage("Если аккаунт существует, на его email придёт инструкция."); return;
      }
      if (mode === "reset") {
        const result = await authClient.resetPassword({ token: resetToken, newPassword: password });
        if (result.error) throw new Error("Ссылка недействительна или истекла. Запросите новую.");
        setMessage("Пароль изменён. Войдите с новым паролем. Если email ещё не подтверждён, при входе будет отправлен код подтверждения. Для организаторов и администратора также требуется TOTP."); return;
      }
      const result = await authClient.twoFactor.verifyTotp({ code: value, trustDevice: false });
      if (result.error) throw new Error("Код неверен или истёк.");
      router.refresh(); router.push("/cabinet");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Повторите попытку позже."); }
    finally { setBusy(false); }
  }
  const field = "mt-2 w-full rounded-lg border border-border bg-white px-3 py-3 focus:outline-2 focus:outline-primary";
  return <main className="mx-auto max-w-lg px-6 py-12">
    <Link href="/" className="text-sm text-primary">← Сибирская математическая олимпиада</Link>
    <h1 className="mt-8 text-3xl font-semibold">{titles[mode]}</h1>
    <p className="mt-4 text-sm leading-6 text-slate-600">Учебная версия: используйте только вымышленные данные. Реальные персональные данные пока не принимаются.</p>
    <form method="post" onSubmit={submit} className="mt-6 space-y-5">
      {mode === "register" && <><label className="block">ФИО<input required name="name" minLength={3} maxLength={200} autoComplete="name" className={field} /></label>
        <label className="block">Университет<select required name="universityId" className={field} defaultValue=""><option value="" disabled>Выберите вуз</option>{universities.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="block">Курс<select required name="courseId" className={field} defaultValue=""><option value="" disabled>Выберите курс</option>{courses.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label></>}
      {["login", "register", "verify", "forgot"].includes(mode) && <label className="block">Email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></label>}
      {["login", "register", "reset"].includes(mode) && <label className="block">Пароль<input type="password" name="password" required minLength={mode === "login" ? 1 : 12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} className={field} /><span className="text-xs text-slate-600">Для нового пароля — не менее 12 символов.</span></label>}
      {["verify", "two-factor"].includes(mode) && <label className="block">Код {mode === "verify" ? "из письма" : "из приложения-аутентификатора"}<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} className={field} /></label>}
      {mode === "register" && <fieldset className="space-y-3 rounded border p-3"><legend>Аккаунт nsuhw</legend>
        <label className="flex gap-3"><input type="checkbox" checked={hasLegacy} onChange={e=>setHasLegacy(e.target.checked)} />У меня уже есть аккаунт nsuhw</label>
        {hasLegacy?<><label className="block">Старый логин nsuhw<input name="legacyLogin" required maxLength={254} className={field} autoComplete="off" /></label><label className="flex gap-3 text-sm"><input type="checkbox" name="legacyConfirmed" required />Прошу главного организатора проверить и привязать этот логин. До проверки новые данные nsuhw мне не генерируются.</label><p className="text-sm">Пароль nsuhw не вводите. Новый аккаунт ЛК не подтверждает владение указанным логином.</p></>:<><p>Основное ФИО остаётся в исходном написании. Следующие поля нужны только для нового логина nsuhw: буквы A–Z, без пробелов и знаков. Написание выберите самостоятельно; автоматической транслитерации нет.</p>
        <label className="block">Имя латиницей для логина<input name="firstNameLatin" value={firstNameLatin} onChange={e=>setFirstNameLatin(e.target.value)} required pattern="[A-Za-z]+" maxLength={80} autoComplete="off" className={field}/></label>
        <label className="block">Фамилия латиницей для логина<input name="lastNameLatin" value={lastNameLatin} onChange={e=>setLastNameLatin(e.target.value)} required pattern="[A-Za-z]+" maxLength={80} autoComplete="off" className={field}/></label>
        <p role="status">{preview?`Предварительный логин: ${preview}`:"Введите имя и фамилию латиницей, чтобы увидеть предварительный логин"}</p><p className="text-sm">Это ещё не выданный логин. При совпадении сервер добавит индекс: 2, 3 и далее. Генерация аккаунтов nsuhw пока не включена.</p></>}
      </fieldset>}
      {mode === "register" && <label className="flex gap-3 text-sm leading-6"><input name="demoConsent" type="checkbox" required className="mt-1 size-5 shrink-0" />Использую только вымышленные данные. Это учебная заглушка, а не юридическое согласие на обработку реальных ПДн.</label>}
      <Button disabled={busy} type="submit">{busy ? "Подождите…" : "Продолжить"}</Button>
      {message && <p role="status" className="rounded-lg border border-border bg-white p-4 text-sm">{message}</p>}
    </form>
    {mode === "verify" && <Button variant="outline" className="mt-4" disabled={busy || !email} onClick={async () => {
      setBusy(true);
      try { await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" }); setMessage("Если подтверждение требуется, код отправлен. Проверьте почту."); }
      catch { setMessage("Не удалось отправить. Повторите позже."); } finally { setBusy(false); }
    }}>Отправить код повторно</Button>}
    <nav aria-label="Доступ к аккаунту" className="mt-8 flex flex-wrap gap-4 text-sm text-primary">
      <Link href="/login">Вход</Link><Link href="/register">Регистрация</Link><Link href="/verify">Подтвердить email</Link><Link href="/forgot-password">Забыли пароль?</Link>
    </nav>
  </main>;
}
