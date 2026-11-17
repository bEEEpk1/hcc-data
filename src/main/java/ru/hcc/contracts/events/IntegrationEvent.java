package ru.hcc.contracts.events;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** Common wire envelope for CORE and AUTH. No JPA or transport dependencies. */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public record IntegrationEvent(
        @JsonProperty("event_id") UUID eventId,
        @JsonProperty("event_type") String eventType,
        @JsonProperty("producer_service") String producerService,
        @JsonProperty("occurred_at") Instant occurredAt,
        @JsonProperty("correlation_id") UUID correlationId,
        @JsonProperty("causation_id") UUID causationId,
        @JsonProperty("operation_id") UUID operationId,
        @JsonProperty("payload") Map<String, Object> payload
) {}
