import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { announcementOptions } from "@/lib/announcements";
import { db } from "@/lib/db";
import { CatalogManager } from "@/components/catalog-manager";
export const dynamic="force-dynamic";
export default async function Catalogs(){const {user}=await requireSession();if(user.role!=="CHIEF_ORGANIZER")redirect("/cabinet");const editions=await announcementOptions(db,user.id);return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1>Вузы и курсы</h1><CatalogManager editions={editions}/></main>;}
