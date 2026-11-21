import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { personalHistory } from "@/lib/personal-history";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { user } = await requireSession(); if (user.role !== "STUDENT") redirect("/cabinet");
  const value = (await searchParams).page, page = value && /^\d{1,4}$/.test(value) && Number(value) > 0 ? Number(value) : 1;
  const history = await personalHistory(db, user.id, page);
  return <main className="mx-auto max-w-4xl space-y-6 p-8"><Link href="/cabinet/profile">← Профиль</Link><h1 className="text-3xl">Моя история результатов</h1><p>Записи результатов и дипломы сохраняются бессрочно. Здесь только ваши опубликованные результаты за все годы; после итоговых предварительные этого года не показываются.</p><div className="overflow-auto"><table className="w-full text-left"><caption>Год участия, баллы и номинация</caption><thead><tr><th>Год</th><th>Вид</th><th>Баллы по задачам</th><th>Сумма</th><th>Номинация (приз)</th></tr></thead><tbody>{history.rows.map(r => <tr key={r.id}><td>{r.year}{r.teamName&&<><p>{r.teamName}</p><ul>{r.members.map((m,i)=><li key={i}>{m.fullName} · курс {m.courseLabel}</li>)}</ul></>}</td><td>{r.kind === "FINAL" ? "Итоговые" : "Предварительные"}</td><td>{r.scores.map(s => `${s.ordinal}: ${s.score ?? "—"}`).join(" · ")}</td><td>{r.total ?? "—"}</td><td>{r.prize ?? "—"}</td></tr>)}</tbody></table></div>{history.rows.length === 0 && <p>Опубликованных результатов пока нет.</p>}<nav>{page > 1 && <Link href={`?page=${page - 1}`}>Предыдущая страница</Link>}{page * 25 < history.total && <Link href={`?page=${page + 1}`}>Следующая страница</Link>}</nav><Link href="/cabinet/diplomas">Мои дипломы</Link></main>;
}
