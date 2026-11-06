import { db } from "@/lib/db";
import { AuthForm } from "@/components/auth-form";
export const dynamic = "force-dynamic";
export default async function Register() {
  if (process.env.DEMO_REGISTRATION !== "true" || process.env.NODE_ENV === "production") return <main className="mx-auto max-w-xl p-12"><h1 className="text-2xl font-semibold">Регистрация пока закрыта</h1><p className="mt-4">До запуска необходимо подготовить юридические документы. Реальные персональные данные не принимаются.</p></main>;
  const [universities, courses] = await Promise.all([
    db.university.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.courseOption.findMany({ where: { active: true }, orderBy: { label: "asc" }, select: { id: true, label: true } }),
  ]);
  return <AuthForm mode="register" universities={universities.map((x) => ({ id: x.id, label: x.name }))} courses={courses} />;
}
