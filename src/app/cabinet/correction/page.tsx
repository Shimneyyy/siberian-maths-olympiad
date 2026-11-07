import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { correctionView } from "@/lib/corrections";
import { AccessDenied } from "@/lib/access";
import { db } from "@/lib/db";
import { ProfileEditor } from "@/components/profile-editor";
export const dynamic = "force-dynamic";
export default async function Correction({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireSession();
  const input = z.object({ editionId: z.uuid(), participationId: z.uuid() }).safeParse(await searchParams);
  if (!input.success) redirect("/cabinet");
  let view;
  try { view = await correctionView(db, user.id, input.data.editionId, input.data.participationId); }
  catch (error) { if (error instanceof AccessDenied) redirect("/cabinet"); throw error; }
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Исправить сведения заявки</h1><ProfileEditor view={view} enabled={process.env.NODE_ENV !== "production" && process.env.DEMO_REGISTRATION === "true"} /></main>;
}
