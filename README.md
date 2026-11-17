# HCC DATA — надёжный сбор и хранение событий

[Веб-консоль React, запуск, фактическая карта REST API и проверка](docs/CONSOLE.md)

**Java 21 / Spring Boot 4.1.2 / Kafka / PostgreSQL 17 / Flyway / Docker Compose.**

DATA — подписчик на значимые события **CORE** и **AUTH**. Сервис надёжно сохраняет события, устраняет повторы, предоставляет журнал и агрегированные запросы; дополнительно ведёт неизменяемые резервные записи и историю сверки с CORE. **DATA не исполняет команды CORE, не изменяет состояния этапов, не считает дедлайны и не отправляет бизнес-уведомления.**

## Быстрый запуск

Требуются Docker Desktop / Docker Engine с Compose V2 и свободные порты `8090`, `9094`, `5445`.

```bash
cp .env.example .env
# обязательно задать свои пароли и токены в .env

docker compose up --build -d
docker compose ps
curl http://localhost:8090/actuator/health
```

При первом запуске `kafka-storage-init` настраивает права на том брокера, а `kafka-init` создаёт `hcc.audit.events.v1`, `hcc.core.events` и `hcc.auth.events`. Обе задачи завершаются. Постоянно работают `kafka`, `postgres`, `data` и `frontend`. Все подключения между контейнерами используют постоянные имена `kafka:9092`, `postgres:5432`. Поэтому тот же Compose можно запускать на стенде без изменений Java-кода.

**Не запускайте второй Kafka из другого проекта на тех же портах.** Хостовый `localhost:9094` нужен исключительно для отладки на той же машине. Удалённый ноутбук не может подключиться к вашему `localhost`; в дальнейшем команды подключатся через общую сеть контейнеров стенда.

## Демонстрационные проверки

```bash
bash scripts/check-db.sh
bash scripts/smoke-kafka.sh
bash scripts/smoke-reserve.sh
# логи при проблемах
docker compose logs -f data
```

`smoke-kafka.sh` публикует **одно и то же событие дважды** и проверяет наличие **одной** записи в аудите. `smoke-reserve.sh` проверяет создание и повтор резервной записи, затем фиксирует решение по сверке. Проверки предполагают `HCC_SECURITY_MODE=demo` (задан в Compose), а токены считывают из `.env`.

### Проверка восстановления после остановки DATA

1. `docker compose stop data`
2. Сформируйте CORE-событие по примеру ниже и отправьте через `docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:9092 --topic hcc.core.events`.
3. `docker compose start data`
4. Убедитесь по `GET /api/audit`, что событие появилось после восстановления. Kafka должна сохранять запись в пределах настроенного срока хранения.

Не используйте `docker compose down -v` на стенде или с ценными данными: эта команда **безвозвратно удалит Docker volumes**, включая базу и Kafka-log.

## События Kafka

Контракт `ru.hcc.contracts.events.IntegrationEvent`: `event_id`, `event_type`, `producer_service`, `occurred_at`, `correlation_id`, `causation_id`, `operation_id`, `payload`. `payload` — `Map<String,Object>`, без зависимости от Jackson 2 Databind. Spring Boot 4 использует Jackson 3.

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_type": "STEP_COMPLETED",
  "producer_service": "CORE",
  "occurred_at": "2026-11-06T12:00:00Z",
  "correlation_id": null,
  "causation_id": null,
  "operation_id": "e6c55f92-7910-43db-897d-e73f6281c3a8",
  "payload": {
    "flight_id": "f-1",
    "checklist_id": "c-1",
    "step_id": "s-1",
    "actor_id": "u-1",
    "actual_time": "2026-11-06T11:58:00Z"
  }
}
```

Для AUTH: `producer_service="AUTH"`, `event_type="auth.login.succeeded"` и `payload` только из обезличенных разрешённых полей, например `subject_user_id`, `result`, `reason_code`. **Нельзя передавать пароли, OTP, JWT, cookie или персональные контактные данные.** AUTH-история доступна только по отдельному разрешению.

Приём осуществляется **только через Kafka**, прямой `POST /api/events` отсутствует. События CORE читает группа `hcc-data-core`, AUTH — `hcc-data-auth`.

## Хранение

Единственная начальная миграция: `src/main/resources/db/migration/V1__init.sql`.

| Таблица | Назначение |
| --- | --- |
| `inbound_event` | Исходные принятые сообщения, хеш, уникальность `(producer_service, source_event_id)` |
| `audit_event` | Неизменяемая история с индексами по времени, исполнителю, рейсу, чек-листу |
| `reserve_record` | Неизменяемые факты телефонного / журнального ввода |
| `reconciliation` | Добавляемые решения сверки, новая запись вместо изменения прошлой |
| `ingest_failure` | Технический карантин некорректного сообщения по Kafka offset и SHA-256 **без исходного payload** |

`hcc_app` имеет только `SELECT` и `INSERT` на эти таблицы. `UPDATE/DELETE/TRUNCATE` также запрещены SQL-триггерами. `hcc_migrator` владеет схемой и выполняет Flyway. База DATA не содержит физических внешних ключей на БД CORE или AUTH.

## Гарантии надёжности и пределы

- **At-least-once**: Kafka offset подтверждается после коммита записи PostgreSQL; при ошибке БД обработка повторяется без конечного лимита попыток.
- **Idempotency**: повторный `(producer_service,event_id)` с тем же канонизированным сообщением не создаёт копию в аудите. Иное содержимое с тем же ID — конфликт; он регистрируется как ошибка приёма.
- **Append-only**: аудит, резервные записи и история решений не переписываются.
- Некорректное сообщение не помещается в достоверный аудит. Его topic/partition/offset и хеш сохраняются в `ingest_failure`. **Сырой текст доступен лишь до истечения Kafka retention**; по прошествии retention такое сообщение нельзя восстановить. Для полностью воспроизводимого карантина понадобится отдельное защищённое хранилище шифрованных исходных сообщений.
- **Нет абсолютной гарантии потерь = 0**: при полном отказе единственного Kafka-диска события могут исчезнуть; событие, которое CORE не смог отправить, DATA не восстановит. Для промышленной надёжности производителям нужен transactional outbox, Kafka — репликация, PostgreSQL — резервное копирование, а также мониторинг consumer lag.
- Топики и `producer_service` проверяются логически, но локальная Kafka настроена на **PLAINTEXT без ACL**. Для стенда с недоверенной сетью нужны SASL/TLS и ACL. Не публикуйте чувствительные данные даже в защищённый транспорт.

## Резервный ввод

`POST /api/reserve-records` (scope `recovery.manage`) — резервная запись с `operation_id`, `checklist_id`, `step_id`, `event_type`, `actor_id`, `source=PHONE|BACKUP_JOURNAL`, `actual_time`, `reason`, `data`, а также `source_ref` для бумажного журнала. `registered_by` берётся из авторизованного principal; подменить его полем запроса нельзя.

Для корректировки исходной резервной записи создайте **новую** запись с `corrects_reserve_record_id` предыдущей; исправлять существующую строку нельзя.

Повтор с тем же `operation_id` и тем же телом возвращает `DUPLICATE`; с другим — `409`. Резервная запись **не закрывает этап в CORE**.

`POST /api/reserve-records/{id}/reconciliations` — решения `DUPLICATE`, `UNIQUE`, `CONFLICT`, при необходимости `matched_audit_id`. Для последующего решения указывают `supersedes_id` последней записи. Для официального выполнения бизнес-действия обращаются в CORE отдельно. В DATA остаются исходный факт и история решений.

Полный список HTTP-методов и примеры запросов: [docs/API.md](docs/API.md).

## Режимы доступа

В Compose установлен демонстрационный режим по двум токенам из `.env`: supervisor (резервный ввод, обычный аудит), auditor (обычный и security-аудит, чтение резервных записей). Это **не production-аутентификация**.

Для JWT используйте `HCC_SECURITY_MODE=jwt` и активируйте Spring-профиль `jwt`, передав `HCC_JWT_ISSUER_URI` доступного AUTH/JWK provider. JWT должен содержать требуемые scopes: `audit.read`, `security_audit.read`, `recovery.read`, `recovery.manage`. Идентификатор регистратора берётся из `Authentication.getName()` (проверенный principal).

## Сборка, тесты и ограничения проверки

```bash
# Java 21 и Maven 3.9+
mvn clean verify
# или Docker multi-stage build выполняет mvn clean verify сам
docker compose build data
```

Нужен **чистый экземпляр PostgreSQL**: это единственная начальная миграция и она рассчитана на создание схемы, а не изменение существующей БД. Никакие существующие данные нельзя удалять без отдельного плана миграции.

[Демонстрационная база и сценарий показа](docs/DEMO.md)
