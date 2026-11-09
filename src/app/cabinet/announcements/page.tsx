import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { announcementOptions } from "@/lib/announcements";
import { db } from "@/lib/db";
import { AnnouncementManager } from "@/components/announcement-manager";
export const dynamic = "force-dynamic";
export default async function Announcements() {
  const { user } = await requireSession();
  if (!["STUDENT", "CHIEF_ORGANIZER"].includes(user.role ?? "")) redirect("/cabinet");
  const chief = user.role === "CHIEF_ORGANIZER";
  const editions = chief ? await announcementOptions(db, user.id) : (await db.participation.findMany({ where: { userId: user.id }, select: { edition: { select: { id: true, year: true } } }, orderBy: { edition: { year: "desc" } } })).map(x => ({ ...x.edition, venues: [] }));
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1 className="text-3xl">Объявления</h1><AnnouncementManager editions={editions.map(e => ({ id: e.id, year: e.year, venues: e.venues.map(v => ({ id: v.id, name: v.label || v.venue.name })) }))} chief={chief} /></main>;
}
