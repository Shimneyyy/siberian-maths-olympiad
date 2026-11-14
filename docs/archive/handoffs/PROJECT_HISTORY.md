# Исторические передачи проекта

Этот файл — навигация по истории, не инструкция следующему агенту.
[Действующее состояние](../../STATUS.md), [решения](../../DECISIONS.md).

## Сохранившиеся исходники

- [HANDOFF](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/HANDOFF.md): развитие B/C/D/E/F, проверки и последующие исправления.
- [DECISIONS](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/DECISIONS.md): первоначальные предложения, ответы и отменяющие решения.
- [TASKS](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/TASKS.md): первоначальная сетка ID/зависимостей и повторные отчёты.
- [RESUME_AUDIT](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/RESUME_AUDIT.md): возобновление 8 ноября 2026, база 687f67f → 8786494.
- [ARCHITECTURE](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/ARCHITECTURE.md) и [SECURITY](https://github.com/Shimneyyy/siberian-maths-olympiad/blob/a921c0981bc041336760c309e1dd527c61202140/docs/SECURITY.md): ранние модели/предложения.

В прежней среде локальная work могла начинаться с eb2a76e при удалённом другом HEAD;
refspec отслеживал только main. Поэтому восстановление включало явное получение work
и сверку удалённой ссылки. Это описание конкретных сессий, не актуальный HEAD каждой среды.

Исторические остановки после E06, «следующая E08», «генератор не готов» и другие
этапные границы не являются действующим запретом/планом. Поздние уточнения сохраняются
в ADR, детали работающих функций — в contracts. Начальные предложения о ролях,
сроках и хранении не имеют приоритета над принятыми уточнениями.

Учебный релиз и его CI — [отдельный отчёт](../acceptance/RELEASE_27beb6d.md).
Последующие исправления до a921c09 — [расследования](../investigations/BUGFIX_HISTORY.md).
Сведения «сервер остановлен», локальные логи/версии/числа тестов описывают прошлую
среду и не утверждают состояние пользовательской машины сейчас.
