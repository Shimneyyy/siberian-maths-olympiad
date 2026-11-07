import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { adminView } from "@/lib/admin";
import { AdminManager } from "@/components/admin-manager";
export const dynamic = "force-dynamic";
export default async function Admin() {
  const { user } = await requireSession();
  if (user.role !== "TECHNICAL_ADMIN" || !user.twoFactorEnabled) redirect("/cabinet");
  const editions = await adminView(db, user.id);
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Техническое администрирование</h1><AdminManager editions={editions.map(e => ({ ...e, registrationOpensAt: e.registrationOpensAt?.toISOString() ?? null, registrationClosesAt: e.registrationClosesAt?.toISOString() ?? null }))} /></main>;
}
