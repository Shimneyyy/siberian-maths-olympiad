import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { announcementOptions } from "@/lib/announcements";
import { LegacyNsuhwManager } from "@/components/legacy-nsuhw-manager";
export const dynamic = "force-dynamic";
export default async function Nsuhw() {
  const {user} = await requireSession();
  if(!["STUDENT","CHIEF_ORGANIZER"].includes(user.role??"") || (user.role === "CHIEF_ORGANIZER" && !user.twoFactorEnabled)) redirect("/cabinet");
  const chief = user.role === "CHIEF_ORGANIZER";
  const editions = chief ? await announcementOptions(db,user.id) : [];
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Аккаунт nsuhw</h1><p>Учебная версия: только вымышленные данные. Пароль nsuhw не вводите. Связь сайтов — ручная проверка, без автоматического входа.</p><LegacyNsuhwManager chief={chief} editions={editions.map(e=>({id:e.id,year:e.year}))} /></main>;
}
