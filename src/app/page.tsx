import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-12">
      <header className="flex items-center gap-3 border-b border-border pb-6">
        <Image
          src="/olympiad-mark.svg"
          alt=""
          width={1680}
          height={880}
          className="h-auto w-20 shrink-0 sm:w-24"
        />
        <p className="font-semibold">Сибирская математическая олимпиада</p>
      </header>
      <main id="main" className="home-hero mt-8 rounded-3xl border border-border px-6 py-12 md:px-14 md:py-20">
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">Личный кабинет олимпиады</h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">Регистрация, команды, объявления, результаты и дипломы.</p>
        <nav aria-label="Личный кабинет" className="mt-8 flex flex-wrap gap-3">
          <Button asChild><Link href="/login">Войти</Link></Button>
          <Button asChild variant="outline"><Link href="/register">Зарегистрироваться</Link></Button>
        </nav>
        <a className="mt-8 inline-flex font-medium text-primary underline underline-offset-4" href="https://nsuhw.ru" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Задачи и апелляции на nsuhw.ru ↗</a>
      </main>
    </div>
  );
}
