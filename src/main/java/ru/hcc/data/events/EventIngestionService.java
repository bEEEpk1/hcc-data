package ru.hcc.data.events;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.hcc.contracts.events.IntegrationEvent;
import ru.hcc.data.common.CanonicalJson;
import ru.hcc.data.common.JsonSupport;
import ru.hcc.data.common.RejectedEvent;

@Service
public class EventIngestionService {
    private final JdbcTemplate jdbc;
    private final JsonSupport json;
    private final EventValidation validation;
    public record Result(String status, UUID auditId) {}
    public EventIngestionService(JdbcTemplate jdbc, JsonSupport json, EventValidation validation) {
        this.jdbc=jdbc; this.json=json; this.validation=validation;
    }

    /** All inserts for one Kafka event commit atomically. Caller ACKs Kafka after method returns. */
    @Transactional
    public Result ingest(IntegrationEvent event, String source) {
        validation.validate(event, source);
        Map<String,Object> envelope=new HashMap<>();
        envelope.put("event_id",event.eventId());
        envelope.put("event_type",event.eventType());
        envelope.put("producer_service",event.producerService());
        envelope.put("occurred_at",event.occurredAt());
        envelope.put("correlation_id",event.correlationId());
        envelope.put("causation_id",event.causationId());
        envelope.put("operation_id",event.operationId());
        envelope.put("payload",event.payload());
        String body=json.text(CanonicalJson.sort(envelope));
        String fingerprint=JsonSupport.sha256(body);
        UUID inboundId=UUID.randomUUID();
        int inserted=jdbc.update("""
            INSERT INTO inbound_event(inbound_id,producer_service,source_event_id,event_type,content_sha256,event_body)
            VALUES (?,?,?,?,?,?) ON CONFLICT (producer_service,source_event_id) DO NOTHING
            """,inboundId,source,event.eventId(),event.eventType(),fingerprint,json.jsonb(envelope));
        if(inserted==0) {
            String existing=jdbc.queryForObject("""
                SELECT content_sha256 FROM inbound_event
                WHERE producer_service=? AND source_event_id=?
                """,String.class,source,event.eventId());
            if(!fingerprint.equals(existing)) throw new RejectedEvent("EVENT_ID_COLLISION");
            UUID auditId=jdbc.queryForObject("""
                SELECT audit_id FROM audit_event WHERE producer_service=? AND source_event_id=?
                """,UUID.class,source,event.eventId());
            return new Result("DUPLICATE",auditId);
        }
        Map<String,Object> payload=event.payload();
        CoreAuditFields core=CoreAuditFields.from(event,source);
        Instant actual=EventValidation.instant(payload,"actual_time");
        if(actual==null) actual=event.occurredAt();
        String eventSource=source;
        if ("CORE".equals(source)) {
            String declared=EventValidation.string(payload,"source");
            if ("PHONE".equals(declared) || "BACKUP_JOURNAL".equals(declared)) eventSource=declared;
        }
        String subject=EventValidation.string(payload,"subject_user_id");
        if(subject==null && "AUTH".equals(source)) subject=EventValidation.string(payload,"user_id");
        UUID auditId=UUID.randomUUID();
        jdbc.update("""
            INSERT INTO audit_event(audit_id,producer_service,source_event_id,event_type,occurred_at,actual_time,
              correlation_id,causation_id,operation_id,flight_id,checklist_id,step_id,actor_id,
              subject_user_id,registered_by,source,payload)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,auditId,source,event.eventId(),event.eventType(),Timestamp.from(event.occurredAt()),
                Timestamp.from(actual),event.correlationId(),event.causationId(),core.operationId(),
                core.flightId(),core.checklistId(),core.stepId(),core.actorId(),
                subject,EventValidation.string(payload,"registered_by"),eventSource,json.jsonb(payload));
        return new Result("ACCEPTED",auditId);
    }
}
