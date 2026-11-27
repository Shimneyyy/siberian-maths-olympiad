import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { LegacyNsuhwManager } from "@/components/legacy-nsuhw-manager";
export const dynamic = "force-dynamic";
export default async function Nsuhw() {
  const { user } = await requireSession();
  if (user.role !== "STUDENT") redirect("/cabinet");
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Аккаунт nsuhw</h1><LegacyNsuhwManager /></main>;
}
