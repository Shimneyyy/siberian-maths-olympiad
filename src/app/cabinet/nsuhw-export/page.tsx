import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { announcementOptions } from "@/lib/announcements";
import { db } from "@/lib/db";
import { NsuhwExportManager } from "@/components/nsuhw-export-manager";
export const dynamic="force-dynamic";
export default async function NsuhwExport(){
 const {user}=await requireSession();if(user.role!=="CHIEF_ORGANIZER"||!user.twoFactorEnabled)redirect("/cabinet");
 const editions=await announcementOptions(db,user.id);
 return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Передача новых аккаунтов в nsuhw</h1><NsuhwExportManager editions={editions.map(e=>({id:e.id,year:e.year}))}/></main>;
}
