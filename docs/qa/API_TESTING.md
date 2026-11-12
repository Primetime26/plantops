# API testing

База для локального demo: `http://127.0.0.1:3001/api`. В примерах curl POSIX; в PowerShell используйте `curl.exe` либо REST-клиент с теми же методом/URL/JSON. Cookie-файл — временный локальный файл, не коммитить.

## Сессия и ошибки

```sh
curl -i -c /tmp/plantops-cookie.txt http://127.0.0.1:3001/api/session
curl -b /tmp/plantops-cookie.txt http://127.0.0.1:3001/api/equipment
```

Ожидается 200; session содержит `mode:"demo"`, случайную `revision`, `pollMs:5000`, лимиты. Set-Cookie: HttpOnly, SameSite=Strict; на production HTTPS также Secure. Реестр содержит пять активов. Без cookie любой рабочий demo endpoint отвечает:

```json
{
  "error": {
    "code": "SESSION_RESET",
    "message": "Сессия истекла или сервер перезапущен. Обновите демо."
  }
}
```

HTTP409 — сигнал повторить bootstrap. GET можно безопасно повторить; мутацию после восстановления нужно повторить осознанно. Session ID не передаётся в query/JSON, ID оборудования не задаёт принадлежность сессии.

## Неисправность и инцидент

```sh
curl -b /tmp/plantops-cookie.txt -H 'Content-Type: application/json' -H 'X-PlantOps-Request: 1' -d '{"type":"OVERHEAT"}' http://127.0.0.1:3001/api/simulation/equipment/H-101/fault
curl -b /tmp/plantops-cookie.txt http://127.0.0.1:3001/api/equipment/H-101
curl -b /tmp/plantops-cookie.txt 'http://127.0.0.1:3001/api/incidents?status=ACTIVE'
```

Fault → 202, `overheat:true`. Показатель растёт по серверному времени при следующих запросах. После примерно 25 секунд запрос equipment показывает CRITICAL; журнал — один TEMPERATURE. Не делайте вывод о неисправности по ответу fault: команда включает режим, не перескакивает порог мгновенно.

Подставить ID из журнала:

```sh
curl -X PATCH -b /tmp/plantops-cookie.txt -H 'Content-Type: application/json' -H 'X-PlantOps-Request: 1' -d '{}' http://127.0.0.1:3001/api/incidents/INCIDENT_ID/acknowledge
curl -b /tmp/plantops-cookie.txt -H 'Content-Type: application/json' -H 'X-PlantOps-Request: 1' -d '{}' http://127.0.0.1:3001/api/simulation/equipment/H-101/reset
```

ACK →200 ACKNOWLEDGED, resolvedAt=null. Повторный ACK не меняет дату. Reset →200 NORMAL, старый инцидент RESOLVED с resolvedAt. ACK устранённого →409 ALREADY_RESOLVED.

## Заявка

```sh
curl -b /tmp/plantops-cookie.txt -H 'Content-Type: application/json' -H 'X-PlantOps-Request: 1' -d '{"equipmentId":"H-101","title":"Осмотр насоса","description":"Проверить уплотнение","priority":"HIGH","assignee":"Механик"}' http://127.0.0.1:3001/api/maintenance
```

201, JSON (показаны ключевые поля):

```json
{
  "id": "<uuid>",
  "equipmentId": "H-101",
  "title": "Осмотр насоса",
  "status": "OPEN",
  "priority": "HIGH",
  "version": 1,
  "comments": [],
  "history": [{ "action": "CREATED", "detail": "Заявка создана" }]
}
```

```sh
curl -X PATCH -b /tmp/plantops-cookie.txt -H 'Content-Type: application/json' -H 'X-PlantOps-Request: 1' -d '{"version":1,"status":"IN_PROGRESS"}' http://127.0.0.1:3001/api/maintenance/ORDER_ID
curl -b /tmp/plantops-cookie.txt -H 'Content-Type: application/json' -H 'X-PlantOps-Request: 1' -d '{"version":2,"author":"Механик","text":"Осмотр выполнен"}' http://127.0.0.1:3001/api/maintenance/ORDER_ID/comments
curl -X PATCH -b /tmp/plantops-cookie.txt -H 'Content-Type: application/json' -H 'X-PlantOps-Request: 1' -d '{"version":3,"status":"COMPLETED","resolution":"Оборудование проверено, замечаний нет"}' http://127.0.0.1:3001/api/maintenance/ORDER_ID
```

Последовательность: 200 version2 →201 version3 →200 version4. Завершение возможно только при NORMAL. При stale version возвращается 409 VERSION_CONFLICT: перечитать объект и осознанно повторить изменения, не подставлять новую версию автоматически.

DELETE принимает `{"version":4}` и архивирует только терминальную заявку, ответ204. GET карточки архива →404, история в хранилище сохранена. Лимит demo20 учитывает архив; освободить стенд можно полным reset своей сессии.

## Валидация и негативные проверки

| Запрос                                      | Ответ / ожидаемая неизменность           |
| ------------------------------------------- | ---------------------------------------- |
| Fault `{}` / неизвестный type / лишнее поле | 400 VALIDATION_ERROR, режим не изменился |
| `minutes=-1`, `pageSize=101`, status=BAD    | 400                                      |
| Неверный JSON                               | 400 INVALID_JSON                         |
| Тело больше16КБ                             | 413 PAYLOAD_TOO_LARGE                    |
| Cross-site или без `X-PlantOps-Request`     | 403 CROSS_SITE                           |
| Form body вместо JSON                       | 415 CONTENT_TYPE                         |
| HIGH_VIBRATION для T-301                    | 422 NO_SENSOR                            |
| Заявка OPEN→COMPLETED                       | 409 INVALID_TRANSITION                   |
| Завершение без результата                   | 422 RESOLUTION_REQUIRED                  |
| Завершение при аварии                       | 409 EQUIPMENT_UNHEALTHY                  |
| Неизвестный/чужой ID                        | 404, без утечки объекта                  |
| Слишком частые запросы                      | 429 + Retry-After                        |
| Все10 сессий заняты                         | 503 DEMO_FULL + Retry-After              |

Ошибка Zod имеет `error.code`, русское `error.message`, `error.details`. Внутренние ошибки500 не раскрывают стек. Все отклонённые записи проверять повторным GET: статус, версия, длина истории и телеметрии не должны меняться от отклонённой мутации (кроме отдельного штатного шага симулятора по времени).

## Изоляция, CSV, конкурентность

Создайте два cookie-файла A/B. Fault, заявка и reset A не должны менять B; обращение B по ID заявки/инцидента A →404. После перезапуска backend A/B bootstrap создаёт новые независимые состояния.

`GET /incidents/export?status=RESOLVED` — только устранённые события, заголовки + UTF-8 BOM. `GET /analytics/export?minutes=60` — все активы, усреднённые значения выбранного периода. Экспорт не добавляет записей помимо очередного штатного шага симулятора.

Конкурентные сценарии воспроизводятся в `demo.test.ts` и `api.test.ts` через Promise.all: идентичные version дают200/409, параллельные чтения одного времени не умножают число шагов, повторные faults не создают новые открытые инциденты. SQLite и memory используют общие бизнес-сервисы.
