import { Button } from "@/components/ui/button";

const roles = [
  ["Студент", "Регистрация на олимпиаду, команда, результаты и дипломы."],
  ["Главный организатор", "Управление олимпиадой, площадками и публикациями."],
  ["Организатор площадки", "Список участников своей площадки и учёт явки."],
];
export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-12">
      <header className="flex items-center gap-3 border-b border-border pb-6">
        <span aria-hidden="true" className="grid size-11 place-items-center rounded-xl bg-primary text-xl font-bold text-white">∑</span>
        <div><p className="font-semibold">Сибирская математическая олимпиада</p><p className="text-sm text-slate-600">Личный кабинет</p></div>
      </header>
      <main id="main" className="py-16 md:py-24">
        <p className="mb-5 text-sm font-semibold tracking-widest text-primary">СМО · УЧАСТНИКАМ И ОРГАНИЗАТОРАМ</p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">Всё об участии<br />в одном кабинете</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Площадки, команды, объявления и итоги олимпиады. Решения задач и апелляции — на nsuhw.ru.</p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button asChild><a href="https://nsuhw.ru" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Перейти на nsuhw.ru ↗</a></Button>
          <p className="text-sm text-slate-600">Сервис проверки работ</p>
        </div>
        <aside className="mt-12 rounded-xl border border-border bg-white p-5" aria-label="Состояние сервиса">
          <p className="font-medium">Личный кабинет готовится к запуску</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">Регистрация и вход пока недоступны. Сбор персональных данных не ведётся.</p>
        </aside>
        <section aria-label="Возможности будущего кабинета" className="mt-8 grid gap-5 md:grid-cols-3">
          {roles.map(([title, description]) => <article key={title} className="rounded-xl border border-border bg-white p-6"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-3 leading-7 text-slate-600">{description}</p></article>)}
        </section>
      </main>
      <footer className="border-t border-border py-6 text-sm text-slate-600">Сибирская математическая олимпиада</footer>
    </div>
  );
}
