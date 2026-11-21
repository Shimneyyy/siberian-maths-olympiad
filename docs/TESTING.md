# Проверки проекта

Сверено с [package.json](../package.json), [CI](../.github/workflows/ci.yml) и
[HTTP runner](../scripts/test-http.mjs) на базе a921c09 и актуализировано 20 ноября 2026. Это карта запуска и покрытия,
не отчёт о новом успешном прогоне. Результаты конкретных запусков — [архив](archive/README.md).

## Подготовка и изоляция

Linux/WSL, Node.js 24, зависимости npm ci, Prisma generate. Отдельная локальная/CI
PostgreSQL-БД с миграциями и synthetic seed, .env с существующим непустым
BETTER_AUTH_SECRET, SMTP на Mailpit. Команды начальной подготовки — [README](../README.md).
Для прямых demo CLI установить DEMO_REGISTRATION=true; runner HTTP выставляет его сам.
Учебный keyring создать после миграций: DEMO_REGISTRATION=true npm run nsuhw:keys -- init.
Не заменять ключи существующей БД; тесты не повод для migrate reset.

Для files/communications/restore-drill нужен настоящий ClamAV:
docker compose --profile files up -d --build --wait clamav pdf-inspector pdf-relay.
Prlimit находится внутри PDF-контейнера; app не запускает парсер под своим UID.
Для pinned synthetic баз CI явно задаёт CLAMAV_MAX_DATABASE_AGE_HOURS=720; по
умолчанию 168 и stale-базы блокируют сканирование. Настройка не доказывает их актуальность.
Для Chromium: npx playwright install chromium (в CI --with-deps), либо
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium, если браузер уже установлен.

DB/HTTP/browser/ops/load запускать последовательно. Общие test:db и test:http
создают/очищают fixtures и используют singleton-admin: не запускать поверх ручных
аккаунтов. test:live также требует отдельной тестовой среды. Другой dev на 3100 и
параллельные dev/build/typegen в этом checkout остановить до browser-runner.

Communications/load/account-switch/registration runner создают и удаляют свою
loopback-БД smo_test_<UUID>, требуют CREATE DATABASE. Auth HTTP/live используют
предоставленную БД. Все HTTP runner используют .next/test-runtime, очищают только
свой runtime и ждут завершения своего сервера. Одновременные runner конфликтуют.

## Команды и покрытие

| Команда | Что выполняет / дополнительные условия |
| --- | --- |
| npm run lint | ESLint |
| npm run typecheck | Next typegen и TypeScript noEmit; генерирует .next |
| npm run test:pg | pg-adapter/registrations с --throw-deprecation; PostgreSQL |
| npm run test:db | Последовательные service/DB/CLI тесты из package.json, включая отказ session/audit, конкурентные auth limits, staff reauth, каталоги, preparation leases, orphan staging, scopes, гонки команд, миграцию самоввода логина, SQL-инварианты, новый CSV, импорт, outbox, lifecycle и parser-примитивы |
| npm run test:achievements | Chromium: правка логина, новая версия/публикация/отзыв, командный CSV/курсы, повтор после потерянного ответа и защита старой вкладки; временная БД |
| npm run ops:check | Read-only local synthetic preflight: runtime/миграции/права/worker/AV/SMTP, без отправки письма; не допуск production |
| npm run test:files | Дипломы/PDF/ZIP/карантин/протокол и реальный ClamAV/EICAR; PostgreSQL, prlimit, сканер |
| npm run test:ops | Managed backup и настоящий restore-drill; PostgreSQL/Docker, ClamAV, synthetic env |
| npm run test:http | Семь auth/HTTP сценариев через dev :3100, Mailpit; предоставленная тестовая БД |
| npm run test:registration | Два отдельных запуска registration-http: настоящий отказ keyring и SMTP, UI/rollback/сохранение аккаунта |
| npm run test:account-switch | Chromium: auth/autofill/меню/пустой admin → создание выпуска в UI с повтором потерянного ответа → сроки → назначение; временная БД |
| npm run test:live | Две Chromium-сессии, удаление команды/входящие приглашения/профиль/явка/offline/отзыв, manual export 403/polling, каталоги и 375px; предоставленная тестовая БД |
| npm run test:communications | Chromium/HTTP/SMTP, объявления/рассылки/nsuhw/результаты/дипломы/история; preview/apply 401/403/409 и потеря ответа после commit с UI-повтором; временная БД |
| npm run test:load | Временная БД, optimized build/start, 5000 участников/год × 2, 200 сессий, 600 измеренных запросов |
| npm run build | Next build |
| npm run check:build | Проверка путей server .nft.json на включение .local/env/keyring/каталога дипломов; после build |

Точный список тестовых файлов — scripts в package.json. Не вычислять текущую
готовность по историческим числам общего DB-набора. test:db не подменяет test:files,
а успешный check:build не является универсальным сканированием содержимого секретов.

## Порядок полного CI

Workflow делает npm ci → db:generate → db:migrate → db:seed дважды → keyring init →
lint → typecheck → запуск ClamAV/PDF-worker/relay → test:pg → test:db → test:files → test:ops →
установка Chromium → test:http → test:registration → test:account-switch → test:live →
test:achievements → test:communications → test:load → build → check:build.
В CI PG_CONTAINER указывает существующий PostgreSQL service-контейнер для ops.
Каждый шаг в pipeline последовательный. Наличие шага не означает его успех на HEAD.
Отдельного шага npm audit нет; для проверки зависимостей его запускают отдельно,
фиксируя ревизию, дату, команду и фактический результат.

## Ограничения приёмки

Load использует готовые auth-сессии, не 200 password-login/браузеров; три волны по
200 запросов и дополнительную проверку явки/отзыва. Timeout списка остаётся 4с,
обновление явки проверяется в пределах 10с. Это не SLA/soak целевой инфраструктуры.
PDF/AV-тесты не доказывают безопасность любого файла, freshness production-баз,
обработку максимального ZIP или изоляцию нескольких процессов.
Native Windows executor/Windows ACL и пользовательский WSL этим pipeline не проверены.
Реальные nsuhw, ПДн, внешняя почта, production-провайдеры не вызываются.

Сбой DB/аудита/outbox должен проверяться как rollback всей транзакции, отдельно от
частичных ошибок строк. Триггеры неизменяемости не отключать ради cleanup: используются
свои схемы/временные БД. Для адаптера важны ошибка/rollback и независимые соединения.

## Ручная проверка и диагностика

[MANUAL_TESTING](MANUAL_TESTING.md) описывает сквозной путь отдельных ролей.
Для readonly диагностики синтетического аккаунта в loopback-БД:

```sh
DEMO_REGISTRATION=true npm run auth:inspect -- student@example.test
```

Вывод: exists/role/emailVerified/hasLocalPassword/hasStudentProfile и признак временной
БД; пароль/хеш/токены/ключи не выводятся и аккаунт не меняется. exists=false — проверить
DATABASE_URL/сервер/очистку временной БД. hasLocalPassword=false у нового staff ожидаем
до установки через восстановление; reset не подтверждает email. Вводить пароль ЛК,
а не nsuhw. Секреты и дампы в чат не отправлять.
