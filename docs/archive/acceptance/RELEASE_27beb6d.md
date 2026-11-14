# Историческая передача учебного релиза 27beb6d

Дата источника: 9 ноября 2026. Код: 27beb6dd2571ff2ac39eb5f0674bb75d553bc7fe.
[Исходная передача](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/RELEASE_HANDOFF.md),
[зафиксированный Actions run](https://github.com/Shimneyyy/siberian-maths-olympiad/actions/runs/42561643491).
Здесь сохранены заявленные источником результаты; run заново при реорганизации не проверялся.

| Набор в том отчёте | Результат |
| --- | --- |
| Setup/generate/migrate/двойной seed/keyring | Успех; 26 миграций |
| lint/typecheck | Успех |
| DB/service/CLI | 113/113 |
| Files/PDF/ClamAV/EICAR | 19/19 |
| Backup/restore ops | 3/3, seeded drill 4234 мс |
| Auth HTTP/Chromium | 6/6 |
| Live / communications / load | По 1/1 |
| build/check:build | Успех, 76 traces |

Load: 5000 участников/год × 2, 200 активных подготовленных сессий, 600 измеренных
запросов, 0 ошибок, p50 2911 мс / p95 3765 мс / max 3824 мс при timeout списка 4000 мс.
Проверялись явка/отзыв. Это не 200 браузеров/логинов или длительный production SLA.

Ранние CI выявили dev-нагрузку/503. Последовательно появились SQL groupBy фасетов,
индекс editionId/fullName/id, scoped server-side IDs, отдельный optimized runtime,
app-пул 20 и maxWait 3000 мс. Первопричина старого 503 без diagnostic code не объявлена
доказанной. История и метрики разных запусков не являются прямым benchmark.

После этой базы были другие изменения, включая pg-adapter и auth/UI-исправления.
Поэтому этот успешный run не подтверждает a921c09. Исторические 26 миграций и
76 traces не являются актуальными нормативами.
Production/реальные ПДн/провайдеры/реальный nsuhw не принимались.
