import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { studentOlympiadView } from "@/lib/olympiad-view";
import { AnnualRegistration } from "@/components/annual-registration";
export const dynamic = "force-dynamic";
export default async function Olympiad() {
  const { user } = await requireSession();
  if (user.role !== "STUDENT") redirect("/cabinet");
  const view = await studentOlympiadView(db, user.id);
  return <main className="mx-auto max-w-3xl space-y-8 px-6 py-12"><Link href="/cabinet" className="text-primary">← Личный кабинет</Link><h1 className="text-3xl font-semibold">Участие в олимпиаде</h1><AnnualRegistration view={view} enabled={process.env.NODE_ENV !== "production" && process.env.DEMO_REGISTRATION === "true"} /></main>;
}
