import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { teamsView } from "@/lib/teams";
import { db } from "@/lib/db";
import { TeamManager } from "@/components/team-manager";
export const dynamic = "force-dynamic";
export default async function Teams() {
  const { user } = await requireSession();
  if (user.role !== "STUDENT") redirect("/cabinet");
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Команды олимпиады</h1><TeamManager editions={await teamsView(db, user.id)} enabled={process.env.NODE_ENV !== "production" && process.env.DEMO_REGISTRATION === "true"} /></main>;
}
