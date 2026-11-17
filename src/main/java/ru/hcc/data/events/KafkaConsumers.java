package ru.hcc.data.events;

import java.util.Map;
import java.util.Set;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;
import ru.hcc.contracts.events.IntegrationEvent;
import ru.hcc.data.common.JsonSupport;
import ru.hcc.data.common.RejectedEvent;

@Component
public class KafkaConsumers {
    private static final Logger LOG = LoggerFactory.getLogger(KafkaConsumers.class);
    private static final Set<String> ENVELOPE_FIELDS = Set.of(
        "event_id","event_type","producer_service","occurred_at",
        "correlation_id","causation_id","operation_id","payload");
    private final EventIngestionService ingestion;
    private final IngestFailureService failures;
    private final JsonSupport json;
    public KafkaConsumers(EventIngestionService ingestion, IngestFailureService failures, JsonSupport json) {
        this.ingestion=ingestion; this.failures=failures; this.json=json;
    }
    @KafkaListener(topics="#{'${hcc.kafka.topics.core}'.split(',')}", groupId="hcc-data-core")
    public void core(ConsumerRecord<String,String> record, Acknowledgment ack) {
        consume(record,ack,"CORE");
    }
    @KafkaListener(topics="${hcc.kafka.topics.auth}", groupId="hcc-data-auth")
    public void auth(ConsumerRecord<String,String> record, Acknowledgment ack) {
        consume(record,ack,"AUTH");
    }
    private void consume(ConsumerRecord<String,String> record, Acknowledgment ack, String expected) {
        try {
            String raw=record.value();
            if(raw==null || raw.length()>262144) throw new RejectedEvent("MESSAGE_SIZE_INVALID");
            IntegrationEvent event;
            try {
                Map<String,Object> envelope=json.map(raw);
                if(envelope==null || envelope.keySet().stream().anyMatch(k -> !ENVELOPE_FIELDS.contains(k)))
                    throw new RejectedEvent("UNKNOWN_ENVELOPE_FIELD");
                event=json.parse(raw,IntegrationEvent.class);
            } catch (RejectedEvent invalid) { throw invalid; }
            catch (RuntimeException badJson) { throw new RejectedEvent("MALFORMED_JSON"); }
            var result=ingestion.ingest(event,expected);
            ack.acknowledge(); // AFTER committed DB transaction, including exact duplicate.
            LOG.debug("Event {} {}",record.offset(),result.status());
        } catch (RejectedEvent invalid) {
            // Store safe reference so the operator can inspect the Kafka offset before retention.
            // Do not persist possibly-secret raw messages.
            failures.quarantine(record,invalid.code());
            ack.acknowledge(); // only after durable quarantine metadata commit.
            LOG.warn("Rejected Kafka record at {}:{}:{} [{}]",record.topic(),record.partition(),
                    record.offset(),invalid.code());
        }
        // All other failures (e.g. PostgreSQL down) propagate and are retried indefinitely.
    }
}
