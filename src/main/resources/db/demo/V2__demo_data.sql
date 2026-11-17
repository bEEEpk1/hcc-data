-- Fictional ground operations, relative to the day this demo is installed.
SET LOCAL search_path TO hcc_data;

CREATE TEMP TABLE demo_events ON COMMIT DROP AS
WITH flights AS (
    SELECT n, 'DEMO-HCC-' || (4100 + n) AS flight,
           'DEMO-CL-' || (4100 + n) AS checklist,
           (ARRAY['A320','B737-800','SSJ100'])[1 + (n-1)%3] AS aircraft,
           date_trunc('minute', now()) - interval '90 minutes'
               - (n-1) * interval '55 minutes' AS started_at
    FROM generate_series(1, 12) AS n
), steps AS (
    SELECT * FROM (VALUES
        (1, 'CHECKLIST_CREATED', 'OPEN', 'Открыт чек-лист подготовки борта', 'DISPATCH'),
        (2, 'STEP_COMPLETED', 'RAMP_INSPECTION', 'Внешний осмотр завершён', 'RAMP'),
        (3, 'STEP_COMPLETED', 'BAGGAGE', 'Загрузка багажа завершена', 'RAMP'),
        (4, 'STEP_COMPLETED', 'FUEL', 'Проверка заправки завершена', 'FUEL'),
        (5, 'STEP_COMPLETED', 'DOCUMENTS', 'Полётная документация проверена', 'DISPATCH'),
        (6, 'CHECKLIST_COMPLETED', 'RELEASE', 'Чек-лист подготовки закрыт', 'DISPATCH')
    ) AS s(seq, action, step, message, actor)
)
SELECT md5('hcc-demo-event-' || n || '-' || seq)::uuid AS event_id,
       md5('hcc-demo-audit-' || n || '-' || seq)::uuid AS audit_id,
       md5('hcc-demo-operation-' || n || '-' || seq)::uuid AS operation_id,
       md5('hcc-demo-flight-' || n)::uuid AS correlation_id,
       'CORE'::text AS producer, 'audit.log'::text AS event_type,
       started_at + seq * interval '8 minutes' AS occurred_at,
       flight, checklist, 'DEMO-' || step AS step, 'DEMO-' || actor AS actor, NULL::text AS subject,
       jsonb_build_object('level','INFO','source','CORE','message',message,'data',
           jsonb_build_object('action',action,'flightId',flight,'checklistId',checklist,
               'itemId','DEMO-' || step,'actorUserId','DEMO-' || actor,'aircraftType',aircraft,'demo',true)) AS payload
FROM flights CROSS JOIN steps
UNION ALL
SELECT md5('hcc-demo-auth-event-' || n)::uuid, md5('hcc-demo-auth-audit-' || n)::uuid,
       md5('hcc-demo-auth-operation-' || n)::uuid, NULL::uuid, 'AUTH',
       CASE WHEN n%4=0 THEN 'auth.login_failed' ELSE 'auth.login' END,
       date_trunc('minute', now()) - n * interval '37 minutes',
       NULL, NULL, NULL, 'DEMO-' || (ARRAY['RAMP','FUEL','DISPATCH'])[1 + (n-1)%3],
       'DEMO-' || (ARRAY['RAMP','FUEL','DISPATCH'])[1 + (n-1)%3],
       jsonb_build_object('result',CASE WHEN n%4=0 THEN 'DENIED' ELSE 'OK' END,'client_id','hcc-demo-console')
FROM generate_series(1, 12) AS n;

INSERT INTO inbound_event (inbound_id, producer_service, source_event_id, event_type, content_sha256, event_body, received_at)
SELECT md5('hcc-demo-inbound-' || event_id)::uuid, producer, event_id, event_type,
       encode(sha256(convert_to(body::text,'UTF8')),'hex'), body, occurred_at + interval '2 seconds'
FROM demo_events
CROSS JOIN LATERAL (
    SELECT jsonb_build_object('event_id',event_id,'producer_service',producer,'event_type',event_type,
        'occurred_at',occurred_at,'correlation_id',correlation_id,'causation_id',NULL,
        'operation_id',operation_id,'payload',payload) AS body
) envelope;

INSERT INTO audit_event (audit_id, producer_service, source_event_id, event_type, occurred_at, actual_time,
                         received_at, operation_id, correlation_id, flight_id, checklist_id, step_id,
                         actor_id, subject_user_id, source, payload)
SELECT audit_id, producer, event_id, event_type, occurred_at, occurred_at,
       occurred_at + interval '2 seconds', operation_id, correlation_id, flight, checklist, step,
       actor, subject, producer, payload
FROM demo_events;

INSERT INTO reserve_record (reserve_record_id, operation_id, request_sha256, flight_id, checklist_id, step_id,
                            event_type, actor_id, registered_by, source, actual_time, registered_at, reason, source_ref, data)
SELECT md5('hcc-demo-reserve-' || n)::uuid, md5('hcc-demo-reserve-op-' || n)::uuid,
       encode(sha256(convert_to('hcc-demo-reserve-' || n,'UTF8')),'hex'),
       flight, checklist, CASE WHEN n=3 THEN 'DEMO-DEICING' ELSE step END,
       'STEP_COMPLETED', CASE WHEN n=2 THEN 'DEMO-RAMP' ELSE actor END,
       'demo-supervisor', CASE WHEN n%2=0 THEN 'BACKUP_JOURNAL' ELSE 'PHONE' END,
       occurred_at - interval '2 minutes', occurred_at + interval '5 minutes',
       (ARRAY['После потери связи оператор сообщил о завершении заправки',
              'Журнал смены указывает другого исполнителя заправки',
              'Обработка борта зафиксирована по телефону во время сбоя связи',
              'Запись из журнала смены ожидает сверки с событием CORE'])[n],
       CASE WHEN n%2=0 THEN 'DEMO-ЖС/' || (90+n) END,
       jsonb_build_object('demo',true,'shift','Утренняя смена','station','Демонстрационная площадка')
FROM generate_series(1,4) AS n
JOIN demo_events ON flight='DEMO-HCC-' || (4100+n) AND step='DEMO-FUEL';

INSERT INTO reconciliation (reconciliation_id, operation_id, request_sha256, reserve_record_id, classification,
                            decision, matched_audit_id, reason, resolved_by, resolved_at, supersedes_id)
SELECT md5('hcc-demo-review-' || r.seq)::uuid, md5('hcc-demo-review-op-' || r.seq)::uuid,
       encode(sha256(convert_to('hcc-demo-review-' || r.seq,'UTF8')),'hex'), reserve.reserve_record_id,
       r.classification, r.decision, audit.audit_id, r.reason, 'demo-supervisor',
       reserve.registered_at + r.seq * interval '7 minutes',
       CASE WHEN r.previous IS NOT NULL THEN md5('hcc-demo-review-' || r.previous)::uuid END
FROM (VALUES
    (1,1,'UNIQUE','REQUEST_CORE_REVIEW',false,'Событие CORE ещё не поступило',NULL::integer),
    (2,1,'DUPLICATE','MARK_DUPLICATE',true,'После восстановления связи найдено событие того же исполнителя',1),
    (3,2,'CONFLICT','ESCALATE',true,'Исполнитель в журнале смены отличается от исполнителя в CORE',NULL),
    (4,3,'UNIQUE','REQUEST_CORE_REVIEW',false,'В CORE нет события для обработки борта',NULL)
) AS r(seq, reserve_no, classification, decision, link_audit, reason, previous)
JOIN reserve_record reserve ON reserve.reserve_record_id=md5('hcc-demo-reserve-' || r.reserve_no)::uuid
LEFT JOIN demo_events audit ON r.link_audit AND audit.flight=reserve.flight_id AND audit.step='DEMO-FUEL'
ORDER BY r.seq;

INSERT INTO ingest_failure (failure_id, topic, partition_no, offset_no, content_sha256, reason_code, received_at)
SELECT md5('hcc-demo-failure-' || n)::uuid, 'hcc.demo.audit.events.v1', 0, n,
       encode(sha256(convert_to('hcc-demo-invalid-' || n,'UTF8')),'hex'), reason,
       now() - n * interval '45 minutes'
FROM (VALUES (1,'EVENT_ID_COLLISION'), (2,'MALFORMED_JSON')) AS failures(n, reason);
