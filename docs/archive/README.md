# Архив документации

Исторические отчёты не являются действующими инструкциями или результатами нового
прогона. Актуальный вход — [STATUS](../STATUS.md), правила — [DECISIONS](../DECISIONS.md).
Старые числа тестов и SHA относятся только к указанным исходным ревизиям.

Архив хранит краткие границы доказательств и ссылки на неизменяемые исходные документы
в Git. Так сохраняются полные записи без дублирования нескольких тысяч строк в
стартовом контексте агента. Исходники доступны также локально через
`git show a921c09:docs/HANDOFF.md` и аналогично для остальных прежних путей.

## Отчёты

- [Приёмка 470cea4](acceptance/F02_470cea4.md).
- [Учебный релиз 27beb6d](acceptance/RELEASE_27beb6d.md).
- [Сводка передачи до a921c09](handoffs/PROJECT_HISTORY.md).
- [Повторная разработка объявлений](investigations/D04_REIMPLEMENTATION.md).
- [Auth и пакеты аудита](investigations/BUGFIX_HISTORY.md).
- [Реорганизация документации](investigations/DOCUMENTATION_RESTRUCTURE.md).

## Куда перенесено содержимое

| Прежний документ в a921c09 | Действующее место | Исторический источник |
| --- | --- | --- |
| HANDOFF.md | STATUS + контракты/ADR | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/HANDOFF.md) |
| RELEASE_HANDOFF.md | STATUS/OPERATIONS | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/RELEASE_HANDOFF.md) |
| RESUME_AUDIT.md | STATUS; команды возобновления не действуют | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/RESUME_AUDIT.md) |
| F02_ACCEPTANCE.md | TESTING + архив приёмки | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/F02_ACCEPTANCE.md) |
| AUTH_ACCOUNT_SWITCH.md | ADR-006, TESTING, MANUAL_TESTING | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/AUTH_ACCOUNT_SWITCH.md) |
| D04_REIMPLEMENTATION.md | ADR-004, COMMUNICATIONS | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/D04_REIMPLEMENTATION.md) |
| E02_ACCOUNT_IMPORT.md | NSUHW | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/E02_ACCOUNT_IMPORT.md) |
| E07_RESULT_IMPORT.md | RESULTS | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/E07_RESULT_IMPORT.md) |
| E09_PRIVATE_FILES.md | DIPLOMAS | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/E09_PRIVATE_FILES.md) |
| BUGFIX_PLAN.md | TASKS + BUGFIX_HISTORY | [Оригинал](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/BUGFIX_PLAN.md) |
| DECISIONS/TASKS/HANDOFF, повторные отчёты | Один контракт, ADR и очередь | [Исходный журнал решений](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/DECISIONS.md) |

Бизнес-требования PRD сохранены. Новая шапка только отделяет исходный документ от
последующих уточнений. Исторические сведения о состоянии конкретной среды не
перенесены как актуальное описание компьютера пользователя.
