package ru.hcc.data;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import ru.hcc.contracts.events.IntegrationEvent;
import ru.hcc.data.common.RejectedEvent;
import ru.hcc.data.events.EventValidation;
import static org.junit.jupiter.api.Assertions.*;

class EventValidationTest {
    private final EventValidation validator = new EventValidation();
    private IntegrationEvent event(String type,String producer,Map<String,Object> payload) {
        return new IntegrationEvent(UUID.randomUUID(),type,producer,Instant.now(),null,null,null,payload);
    }
    @Test void acceptsStepEvent() {
        assertDoesNotThrow(()->validator.validate(event("STEP_COMPLETED","CORE",
            Map.of("checklist_id","cl-1","step_id","s-2","actor_id","u-7")),"CORE"));
    }
    @Test void rejectsProducerMismatch() {
        assertEquals("PRODUCER_MISMATCH",assertThrows(RejectedEvent.class,()->
            validator.validate(event("STEP_COMPLETED","CORE",
                Map.of("checklist_id","c","step_id","s")),"AUTH")).code());
    }
    @Test void rejectsSecretsInNestedPayloads() {
        assertEquals("SENSITIVE_KEY",assertThrows(RejectedEvent.class,()->
            validator.validate(event("STEP_COMPLETED","CORE",Map.of("checklist_id","c",
                "step_id","s","details",Map.of("access_token","secret-value"))),"CORE")).code());
    }
    @Test void rejectsUnexpectedAuthFields() {
        assertEquals("AUTH_UNEXPECTED_FIELD",assertThrows(RejectedEvent.class,()->
            validator.validate(event("auth.login.succeeded","AUTH",
                Map.of("actor_id","u","full_name","Private User")),"AUTH")).code());
    }
    @Test void acceptsAuthWithoutFlightOrChecklist() {
        assertDoesNotThrow(()->validator.validate(event("auth.login.succeeded","AUTH",
                Map.of("subject_user_id","u-1","result","OK")),"AUTH"));
    }
    @Test void rejectsBadActualTime() {
        assertEquals("INVALID_TIME_FIELD",assertThrows(RejectedEvent.class,()->
            validator.validate(event("STEP_COMPLETED","CORE",
                Map.of("checklist_id","c","step_id","s","actual_time","yesterday")),"CORE")).code());
    }
}
