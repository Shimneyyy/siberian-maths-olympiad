import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { ownWithdrawalRequests } from "@/lib/data-lifecycle";
import { PrivacyRequests } from "@/components/privacy-requests";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { user } = await requireSession(); if (user.role !== "STUDENT") redirect("/cabinet");
  const requests = await ownWithdrawalRequests(db, user.id);
  return <main className="mx-auto max-w-3xl space-y-6 p-8"><Link href="/cabinet">← Кабинет</Link><h1 className="text-3xl">Обращения по персональным данным</h1><p>Учебная версия, только синтетические данные. Результаты и дипломы сохраняются бессрочно, аккаунты и участие автоматически не удаляются. Обращение рассматривает оператор вручную; оно не заменяет юридическую процедуру и не удаляет историю автоматически.</p><PrivacyRequests /><h2>Последние обращения</h2><ul>{requests.map(r => <li key={r.id}>{r.createdAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Novosibirsk" })}: {r.reviewedAt ? "Рассмотрено вне системы оператором" : "Ожидает ручного рассмотрения"}</li>)}</ul></main>;
}
