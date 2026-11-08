import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { resultImportOptions } from "@/lib/result-imports";
import { DiplomaManager, OwnDiplomas } from "@/components/diploma-manager";
export const dynamic="force-dynamic";
export default async function Diplomas(){
 const {user}=await requireSession();if(!["STUDENT","CHIEF_ORGANIZER"].includes(user.role??"")||(user.role==="CHIEF_ORGANIZER"&&!user.twoFactorEnabled))redirect("/cabinet");
 const editions=user.role==="CHIEF_ORGANIZER"?await resultImportOptions(db,user.id):[];
 return <main className="mx-auto max-w-5xl space-y-6 px-6 py-12"><Link href="/cabinet">← Кабинет</Link><h1 className="text-3xl">Дипломы</h1><p>Учебный контур. Только синтетические PDF. Студент скачивает только свои опубликованные документы.</p>{user.role==="CHIEF_ORGANIZER"?<DiplomaManager editions={editions}/>:<OwnDiplomas/>}</main>;
}
