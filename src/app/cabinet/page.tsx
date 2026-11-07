import Link from "next/link";
import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { StaffManager } from "@/components/staff-manager";
import { AccountControls } from "@/components/account-controls";
export const dynamic = "force-dynamic";
export default async function Cabinet() {
  const { user } = await requireSession();
  const venues = user.role === "CHIEF_ORGANIZER" && user.twoFactorEnabled ? await db.editionVenue.findMany({
    where: { edition: { staffGrants: { some: { userId: user.id, revokedAt: null } } } },
    include: { venue: true, edition: true, assignments: { where: { revokedAt: null }, include: { user: { select: { id: true, name: true } } } } },
  }) : [];
  const roles = { TECHNICAL_ADMIN: "Технический администратор", STUDENT: "Студент", CHIEF_ORGANIZER: "Главный организатор", VENUE_ORGANIZER: "Организатор площадки" };
  return <main className="mx-auto max-w-3xl px-6 py-12"><h1 className="text-3xl font-semibold">Личный кабинет</h1><p className="mt-4">{user.name}</p><p className="mt-2 text-slate-600">{roles[user.role as keyof typeof roles]}</p><p className="mt-6">Учебная версия. Доступны ежегодная регистрация и история участия. Команды и результаты появятся на следующих этапах.</p>{user.role === "STUDENT" && <Link href="/cabinet/profile" className="mt-4 block text-primary">Редактировать профиль</Link>}<nav aria-label="Разделы кабинета" className="mt-6 flex flex-wrap gap-4 text-primary">{["CHIEF_ORGANIZER", "VENUE_ORGANIZER"].includes(user.role ?? "") && user.twoFactorEnabled && <Link href="/cabinet/registrations">Участники олимпиады</Link>}{user.role === "STUDENT" && <Link href="/cabinet/olympiad">Моё участие в олимпиаде</Link>}{user.role === "CHIEF_ORGANIZER" && user.twoFactorEnabled && <Link href="/cabinet/organization">Годы и площадки</Link>}</nav>{user.role === "TECHNICAL_ADMIN" && user.twoFactorEnabled && <Link href="/cabinet/admin">Техническое администрирование</Link>}<AccountControls enabled={!!user.twoFactorEnabled} />{user.role === "CHIEF_ORGANIZER" && user.twoFactorEnabled && <StaffManager venues={venues.map((v) => ({ id: v.id, editionId: v.editionId, title: `${v.edition.year} · ${v.venue.name}` }))} staff={venues.flatMap((v) => v.assignments.map((a) => ({ userId: a.userId, name: a.user.name, venueId: v.id, editionId: v.editionId, title: `${v.edition.year} · ${v.venue.name}` })))} />}</main>;
}
