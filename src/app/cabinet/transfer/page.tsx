import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { transferView } from "@/lib/transfers";
import { AccessDenied } from "@/lib/access";
import { db } from "@/lib/db";
import { TransferForm } from "@/components/transfer-form";
export const dynamic = "force-dynamic";
export default async function Transfer({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireSession();
  const input = z.object({ editionId: z.uuid(), participationId: z.uuid() }).safeParse(await searchParams);
  if (!input.success) redirect("/cabinet");
  let view;
  try { view = await transferView(db, user.id, input.data.editionId, input.data.participationId); }
  catch(e) { if(e instanceof AccessDenied) redirect("/cabinet"); throw e; }
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet/registrations">← Участники</Link><h1>Перенос очной площадки</h1><TransferForm view={view} /></main>;
}
