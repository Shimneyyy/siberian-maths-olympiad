import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessDenied } from "@/lib/access";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { registrationsOptions, listRegistrations } from "@/lib/registrations";
import { RegistrationsTable } from "@/components/registrations-table";
export const dynamic = "force-dynamic";
export default async function Registrations() {
  const { user } = await requireSession();
  if (!["CHIEF_ORGANIZER", "VENUE_ORGANIZER"].includes(user.role ?? "") || !user.twoFactorEnabled) redirect("/cabinet");
  const options = await registrationsOptions(db, user.id);
  const first = options.editions[0];
  let initial = null;
  try { initial = first ? await listRegistrations(db, user.id, { editionId: first.id }) : null; }
  catch (error) { if (error instanceof AccessDenied) redirect("/cabinet"); throw error; }
  return <main className="mx-auto max-w-7xl space-y-8 px-6 py-12"><Link href="/cabinet" className="text-primary">← Личный кабинет</Link><h1 className="text-3xl font-semibold">Участники олимпиады</h1><RegistrationsTable options={options} initial={initial} /></main>;
}
