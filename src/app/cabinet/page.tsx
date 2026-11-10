import Link from "next/link";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { StaffManager } from "@/components/staff-manager";
import { AccountControls } from "@/components/account-controls";
export const dynamic = "force-dynamic";
export default async function Cabinet() {
  const { user } = await requireSession();
  const venues = user.role === "CHIEF_ORGANIZER" ? await db.editionVenue.findMany({
    where: { edition: { staffGrants: { some: { userId: user.id, revokedAt: null } } } },
    include: { venue: true, edition: true, assignments: { where: { revokedAt: null }, include: { user: { select: { id: true, name: true } } } } },
  }) : [];
  const roles = { TECHNICAL_ADMIN: "Технический администратор", STUDENT: "Студент", CHIEF_ORGANIZER: "Главный организатор", VENUE_ORGANIZER: "Организатор площадки" };
  const sections = [
    ...(user.role === "STUDENT" ? [
      ["/cabinet/profile", "Редактировать профиль"],
      ["/cabinet/teams", "Команды олимпиады"],
      ["/cabinet/olympiad", "Моё участие в олимпиаде"],
    ] : []),
    ...(["CHIEF_ORGANIZER", "VENUE_ORGANIZER"].includes(user.role ?? "") ? [
      ["/cabinet/registrations", "Участники олимпиады"],
    ] : []),
    ...(user.role === "TECHNICAL_ADMIN" ? [["/cabinet/admin", "Техническое администрирование"]] : []),
    ...(["STUDENT", "CHIEF_ORGANIZER"].includes(user.role ?? "") ? [
      ["/cabinet/announcements", "Объявления"],
      ["/cabinet/nsuhw", "Аккаунт nsuhw"],
      ["/cabinet/diplomas", "Дипломы"],
    ] : []),
    ...(user.role === "CHIEF_ORGANIZER" ? [
      ["/cabinet/organization", "Годы и площадки"],
      ["/cabinet/mail", "Рассылки"],
      ["/cabinet/nsuhw-export", "Передача аккаунтов в nsuhw"],
      ["/cabinet/results-import", "Загрузка личных результатов"],
      ["/cabinet/nsuhw-import", "Импорт готовых аккаунтов nsuhw"],
    ] : []),
    ...(["STUDENT", "CHIEF_ORGANIZER", "VENUE_ORGANIZER"].includes(user.role ?? "") ? [
      ["/cabinet/results", "Результаты"],
    ] : []),
  ];
  return <main className="mx-auto max-w-3xl px-6 py-12">
    <h1 className="text-3xl font-semibold">Личный кабинет</h1>
    <p className="mt-4 break-words">{user.name}</p>
    <p className="mt-2 text-slate-600">{roles[user.role as keyof typeof roles]}</p>
    <p className="mt-6">Учебная версия. Используйте только вымышленные данные. Регистрация, история, команды и списки доступны по вашей роли.</p>
    <nav aria-label="Разделы кабинета" className="mt-6 grid gap-3 text-primary sm:grid-cols-2">
      {sections.map(([href, title]) => <Link key={href} href={href} className="rounded-lg border border-border bg-white p-3 break-words hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">{title}</Link>)}
    </nav>
    <AccountControls />
    {user.role === "CHIEF_ORGANIZER" && <StaffManager venues={venues.map((v) => ({ id: v.id, editionId: v.editionId, title: `${v.edition.year} · ${v.venue.name}` }))} staff={venues.flatMap((v) => v.assignments.map((a) => ({ userId: a.userId, name: a.user.name, venueId: v.id, editionId: v.editionId, title: `${v.edition.year} · ${v.venue.name}` })))} />}
  </main>;
}
