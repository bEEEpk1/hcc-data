package ru.hcc.data.events;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Collection;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import ru.hcc.contracts.events.IntegrationEvent;
import ru.hcc.data.common.RejectedEvent;

@Component
public class EventValidation {
    private static final Pattern TYPE = Pattern.compile("[A-Za-z][A-Za-z0-9_.-]{0,127}");
    private static final Set<String> AUTH_KEYS = Set.of(
            "actor_id","subject_user_id","user_id","role","previous_role","new_role",
            "result","reason_code","client_id","ip_hash","session_id_hash","target_user_id",
            "registered_by","action");
    private static final Set<String> ALLOWED_PRODUCERS = Set.of("CORE","AUTH");

    public void validate(IntegrationEvent event, String expectedProducer) {
        if (event == null || event.eventId() == null || event.occurredAt() == null
                || event.eventType() == null || event.payload() == null) fail("MISSING_ENVELOPE_FIELD");
        if (!ALLOWED_PRODUCERS.contains(expectedProducer)
                || !expectedProducer.equals(event.producerService())) fail("PRODUCER_MISMATCH");
        if (!TYPE.matcher(event.eventType()).matches()) fail("INVALID_EVENT_TYPE");
        if (event.occurredAt().isAfter(Instant.now().plusSeconds(300))) fail("INVALID_OCCURRENCE_TIME");
        checkSafeJson(event.payload(),0);
        if ("AUTH".equals(expectedProducer)) {
            if (!event.eventType().startsWith("auth.")) fail("AUTH_EVENT_TYPE_REQUIRED");
            for (var entry : event.payload().entrySet()) {
                if (!AUTH_KEYS.contains(entry.getKey()) || (entry.getValue() != null &&
                    !(entry.getValue() instanceof String) && !(entry.getValue() instanceof Boolean))) {
                    fail("AUTH_UNEXPECTED_FIELD");
                }
            }
        } else {
            if (event.eventType().startsWith("auth.")) fail("CORE_EVENT_TYPE_MISMATCH");
            boolean stepEvent = event.eventType().startsWith("STEP_")
                    || event.eventType().startsWith("step.");
            if (stepEvent && (string(event.payload(),"checklist_id") == null
                    || string(event.payload(),"step_id") == null)) fail("MISSING_STEP_ID");
            if (event.eventType().startsWith("checklist.")
                    && string(event.payload(),"checklist_id") == null) fail("MISSING_CHECKLIST_ID");
        }
        instant(event.payload(), "actual_time");
    }
    public void validateManual(Map<String,Object> map) { checkSafeJson(map,0); }
    private void checkSafeJson(Object obj,int depth) {
        if (depth>12) fail("JSON_TOO_DEEP");
        if (obj instanceof Map<?,?> map) {
            if (map.size() > 200) fail("JSON_TOO_LARGE");
            for (var entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key) || key.length()>128)
                    throw new RejectedEvent("INVALID_JSON_KEY");
                String normalized=key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]","");
                if (normalized.contains("password") || normalized.contains("token") ||
                        normalized.contains("secret") || normalized.contains("otp") ||
                        normalized.contains("cookie") || normalized.contains("authorization") ||
                        normalized.contains("credential") || normalized.contains("email") ||
                        normalized.contains("passport") || normalized.contains("phonenumber") ||
                        normalized.equals("phone") || normalized.equals("pin")) fail("SENSITIVE_KEY");
                checkSafeJson(entry.getValue(),depth+1);
            }
        } else if (obj instanceof Collection<?> collection) {
            if(collection.size()>500) fail("JSON_TOO_LARGE");
            for (Object value : collection) checkSafeJson(value,depth+1);
        } else if (obj != null && !(obj instanceof String) && !(obj instanceof Number) &&
                !(obj instanceof Boolean) && !(obj instanceof UUID) && !(obj instanceof Instant)) {
            fail("INVALID_JSON_VALUE");
        } else if(obj instanceof String text && text.length()>8192) fail("JSON_TOO_LARGE");
    }
    public static String string(Map<String,Object> p, String key) {
        Object value=p.get(key);
        if (value == null) return null;
        if (!(value instanceof String text)) throw new RejectedEvent("INVALID_FIELD_TYPE");
        if(text.isBlank() || text.length()>256) fail("INVALID_STRING_FIELD");
        return text;
    }
    public static Instant instant(Map<String,Object> p,String key) {
        String value=string(p,key);
        if(value==null) return null;
        try { return Instant.parse(value); }
        catch (DateTimeParseException ex) { throw new RejectedEvent("INVALID_TIME_FIELD"); }
    }
    public static void fail(String code) { throw new RejectedEvent(code); }
}
