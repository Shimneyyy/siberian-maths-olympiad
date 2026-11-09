import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { resultImportOptions } from "@/lib/result-imports";
import { AccountImportManager } from "@/components/account-import-manager";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { user } = await requireSession();
  if (user.role !== "CHIEF_ORGANIZER") redirect("/cabinet");
  return <main className="mx-auto max-w-4xl space-y-6 p-8"><Link href="/cabinet">← Кабинет</Link><h1 className="text-3xl">Импорт готовых аккаунтов nsuhw</h1><AccountImportManager editions={await resultImportOptions(db, user.id)} /></main>;
}
