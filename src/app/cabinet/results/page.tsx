import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { registrationsOptions } from "@/lib/registrations";
import { ResultsReader } from "@/components/results-reader";
export const dynamic = "force-dynamic";
export default async function Results() {
  const { user } = await requireSession();
  if (!["STUDENT", "CHIEF_ORGANIZER", "VENUE_ORGANIZER"].includes(user.role ?? "") || (user.role !== "STUDENT" && !user.twoFactorEnabled)) redirect("/cabinet");
  const editions = user.role === "STUDENT" ? (await db.participation.findMany({ where: { userId: user.id }, select: { edition: { select: { id: true, year: true } } }, orderBy: { edition: { year: "desc" } } })).map(p => p.edition) : (await registrationsOptions(db, user.id)).editions;
  return <main className="mx-auto max-w-4xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1 className="text-3xl">Результаты</h1><p>Учебный контур. Студент видит только свои опубликованные результаты; после собственных итоговых — только итоговые. Общая таблица на другом сайте не связана с этим проектом.</p><ResultsReader editions={editions} /></main>;
}
