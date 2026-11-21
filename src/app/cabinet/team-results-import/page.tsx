import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { resultImportOptions } from "@/lib/result-imports";
import { ResultImportManager } from "@/components/result-import-manager";
import { TeamResultRoster } from "@/components/team-result-roster";
import { ResultDocumentManager } from "@/components/result-document-manager";
export const dynamic="force-dynamic";
export default async function TeamResults(){const {user}=await requireSession();if(user.role!=="CHIEF_ORGANIZER")redirect("/cabinet");const editions=await resultImportOptions(db,user.id);return <main className="mx-auto max-w-5xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Загрузка командных результатов</h1><ResultImportManager editions={editions} team/><TeamResultRoster editions={editions}/><ResultDocumentManager editions={editions}/></main>;}
