import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { profileView } from "@/lib/corrections";
import { db } from "@/lib/db";
import { ProfileEditor } from "@/components/profile-editor";
export const dynamic = "force-dynamic";
export default async function Profile() {
  const { user } = await requireSession();
  if (user.role !== "STUDENT") redirect("/cabinet");
  const view = await profileView(db, user.id);
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Редактировать профиль</h1><ProfileEditor view={view} enabled={process.env.NODE_ENV !== "production" && process.env.DEMO_REGISTRATION === "true"} /></main>;
}
