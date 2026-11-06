import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { organizerOlympiadView } from "@/lib/olympiad-view";
import { EditionManager } from "@/components/edition-manager";
export const dynamic = "force-dynamic";
export default async function Organization() {
  const { user } = await requireSession();
  if (user.role !== "CHIEF_ORGANIZER" || !user.twoFactorEnabled) redirect("/cabinet");
  const editions = await organizerOlympiadView(db, user.id);
  return <main className="mx-auto max-w-3xl space-y-8 px-6 py-12"><Link href="/cabinet" className="text-primary">← Личный кабинет</Link><h1 className="text-3xl font-semibold">Годы и площадки олимпиады</h1><EditionManager editions={editions} /></main>;
}
