package ru.hcc.data.events;

import java.util.Map;
import java.util.UUID;
import ru.hcc.contracts.events.IntegrationEvent;
import ru.hcc.data.common.RejectedEvent;

record CoreAuditFields(String flightId, String checklistId, String stepId, String actorId, UUID operationId) {
    static CoreAuditFields from(IntegrationEvent event, String producer) {
        var payload=event.payload();
        Map<?,?> data=Map.of();
        boolean modern="CORE".equals(producer) && "audit.log".equals(event.eventType());
        if(modern && payload.get("data") instanceof Map<?,?> nested) data=nested;

        String actor=field(payload,"actor_id",data,"actorUserId");
        if(actor==null && modern) actor=EventValidation.string(payload,"actor_user_id");
        UUID operation=event.operationId();
        if(operation==null && data.get("operationId")!=null) {
            String nestedId=field(Map.of(),"operation_id",data,"operationId");
            try {
                operation=UUID.fromString(nestedId);
                if(!operation.toString().equalsIgnoreCase(nestedId)) throw new IllegalArgumentException();
            } catch(IllegalArgumentException ex) {
                throw new RejectedEvent("INVALID_OPERATION_ID");
            }
        }
        return new CoreAuditFields(field(payload,"flight_id",data,"flightId"),
                field(payload,"checklist_id",data,"checklistId"),
                field(payload,"step_id",data,"itemId"),actor,operation);
    }

    private static String field(Map<String,Object> payload, String legacy, Map<?,?> data, String current) {
        Object value=data.get(current);
        return value==null ? EventValidation.string(payload,legacy)
                : EventValidation.string(Map.of(current,value),current);
    }
}
