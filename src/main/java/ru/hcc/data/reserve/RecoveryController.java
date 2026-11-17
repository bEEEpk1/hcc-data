package ru.hcc.data.reserve;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.security.Principal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.hcc.data.audit.CoreAuditAction;
import ru.hcc.data.common.ApiException;
import ru.hcc.data.common.CanonicalJson;
import ru.hcc.data.common.JsonSupport;
import ru.hcc.data.common.RejectedEvent;
import ru.hcc.data.events.EventValidation;

@SecurityRequirement(name="dataBearer")
@RestController
@RequestMapping("/api")
public class RecoveryController {
    private final JdbcTemplate jdbc;
    private final JsonSupport json;
    private final EventValidation validation;
    public RecoveryController(JdbcTemplate jdbc,JsonSupport json,EventValidation validation) {
        this.jdbc=jdbc;this.json=json;this.validation=validation;
    }

    public record ReserveRequest(
        @JsonProperty("operation_id") UUID operationId,
        @JsonProperty("flight_id") String flightId,
        @JsonProperty("checklist_id") String checklistId,
        @JsonProperty("step_id") String stepId,
        @JsonProperty("event_type") String eventType,
        @JsonProperty("actor_id") String actorId,
        @JsonProperty("source") String source,
        @JsonProperty("actual_time") Instant actualTime,
        @JsonProperty("reason") String reason,
        @JsonProperty("source_ref") String sourceRef,
        @JsonProperty("data") Map<String,Object> data,
        @JsonProperty("corrects_reserve_record_id") UUID correctsReserveRecordId) {}

    public record ReconcileRequest(
        @JsonProperty("operation_id") UUID operationId,
        @JsonProperty("classification") String classification,
        @JsonProperty("decision") String decision,
        @JsonProperty("matched_audit_id") UUID matchedAuditId,
        @JsonProperty("reason") String reason,
        @JsonProperty("supersedes_id") UUID supersedesId) {}

    public record ActionResult(String status, UUID id) {}

    /** A manual record is a fact in DATA, NOT a CORE step transition. */
    @PostMapping("/reserve-records")
    @Transactional
    public ResponseEntity<ActionResult> create(@RequestBody ReserveRequest request,Principal principal) {
        if(request==null || request.operationId()==null || request.actualTime()==null
                || !validId(request.checklistId()) || !validId(request.stepId())
                || !validId(request.actorId()) || !validType(request.eventType())
                || !validReason(request.reason()) || request.data()==null ||
                !("PHONE".equals(request.source()) || "BACKUP_JOURNAL".equals(request.source())) ||
                ("BACKUP_JOURNAL".equals(request.source()) && !validId(request.sourceRef())) ||
                request.actualTime().isAfter(Instant.now().plusSeconds(300))) {
            throw new ApiException(HttpStatus.BAD_REQUEST,"Invalid reserve record");
        }
        if(request.flightId()!=null && !validId(request.flightId()))
            throw new ApiException(HttpStatus.BAD_REQUEST,"Invalid flight_id");
        if(request.sourceRef()!=null && request.sourceRef().length()>256)
            throw new ApiException(HttpStatus.BAD_REQUEST,"Invalid source_ref");
        try { validation.validateManual(request.data()); }
        catch (RejectedEvent ex) { throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,ex.code()); }
        if(request.correctsReserveRecordId()!=null) {
            var originals=jdbc.queryForList("""
                SELECT checklist_id,step_id FROM reserve_record WHERE reserve_record_id=?
                """,request.correctsReserveRecordId());
            if(originals.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST,"Corrected reserve record not found");
            if(!java.util.Objects.equals(originals.getFirst().get("checklist_id"),request.checklistId())
                    || !java.util.Objects.equals(originals.getFirst().get("step_id"),request.stepId())) {
                throw new ApiException(HttpStatus.BAD_REQUEST,"Correction must reference same checklist/step");
            }
        }
        String registrar=principal.getName(); // NEVER trust registered_by from request body.
        Map<String,Object> canonical=new HashMap<>();
        canonical.put("operation_id",request.operationId());
        canonical.put("flight_id",request.flightId());
        canonical.put("checklist_id",request.checklistId());
        canonical.put("step_id",request.stepId());
        canonical.put("event_type",request.eventType());
        canonical.put("actor_id",request.actorId());
        canonical.put("registered_by",registrar);
        canonical.put("source",request.source());
        canonical.put("actual_time",request.actualTime());
        canonical.put("reason",request.reason());
        canonical.put("source_ref",request.sourceRef());
        canonical.put("data",request.data());
        canonical.put("corrects_reserve_record_id",request.correctsReserveRecordId());
        String hash=JsonSupport.sha256(json.text(CanonicalJson.sort(canonical)));
        UUID id=UUID.randomUUID();
        int inserted=jdbc.update("""
            INSERT INTO reserve_record(reserve_record_id,operation_id,request_sha256,flight_id,
              checklist_id,step_id,event_type,actor_id,registered_by,source,actual_time,
              reason,source_ref,data,corrects_reserve_record_id)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (registered_by,operation_id) DO NOTHING
            """,id,request.operationId(),hash,request.flightId(),request.checklistId(),request.stepId(),
            request.eventType(),request.actorId(),registrar,request.source(),
            Timestamp.from(request.actualTime()),request.reason(),request.sourceRef(),json.jsonb(request.data()),
                request.correctsReserveRecordId());
        if(inserted==1) return ResponseEntity.status(HttpStatus.CREATED).body(new ActionResult("CREATED",id));
        var original=jdbc.queryForMap("""
            SELECT reserve_record_id,request_sha256 FROM reserve_record
            WHERE registered_by=? AND operation_id=?
            """,registrar,request.operationId());
        if(!hash.equals(original.get("request_sha256")))
            throw new ApiException(HttpStatus.CONFLICT,"operation_id reused with different reserve data");
        return ResponseEntity.ok(new ActionResult("DUPLICATE",(UUID)original.get("reserve_record_id")));
    }

    @GetMapping("/reserve-records")
    public List<Map<String,Object>> search(@RequestParam(required=false) String checklistId,
            @RequestParam(required=false) String actorId,@RequestParam(defaultValue="100") int limit) {
        if(limit<1 || limit>500) throw new ApiException(HttpStatus.BAD_REQUEST,"limit must be 1..500");
        StringBuilder sql=new StringBuilder("""
            SELECT reserve_record_id,operation_id,flight_id,checklist_id,step_id,event_type,
                actor_id,registered_by,source,actual_time,registered_at,reason,source_ref,
                corrects_reserve_record_id,data::text AS data_json FROM reserve_record WHERE true
            """);
        List<Object> args=new ArrayList<>();
        if(checklistId!=null) { sql.append(" AND checklist_id=?");args.add(checklistId); }
        if(actorId!=null) { sql.append(" AND actor_id=?");args.add(actorId); }
        sql.append(" ORDER BY registered_at DESC, reserve_record_id DESC LIMIT ?");args.add(limit);
        return jdbc.query(sql.toString(),(rs,i)->reserveRow(rs),args.toArray());
    }
    @GetMapping("/reserve-records/{id}")
    public Map<String,Object> one(@PathVariable UUID id) {
        var records=jdbc.query("""
            SELECT reserve_record_id,operation_id,flight_id,checklist_id,step_id,event_type,
                actor_id,registered_by,source,actual_time,registered_at,reason,source_ref,
                corrects_reserve_record_id,data::text AS data_json FROM reserve_record WHERE reserve_record_id=?
            """,(rs,i)->reserveRow(rs),id);
        if(records.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND,"Reserve record not found");
        Map<String,Object> result=new HashMap<>(records.getFirst());
        result.put("decisions",jdbc.queryForList("""
            SELECT reconciliation_id,operation_id,classification,decision,matched_audit_id,
                reason,resolved_by,resolved_at,supersedes_id FROM reconciliation
            WHERE reserve_record_id=? ORDER BY resolved_at,reconciliation_id
            """,id));
        return result;
    }
    private Map<String,Object> reserveRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String,Object> out=new HashMap<>();
        for(String col:List.of("reserve_record_id","operation_id","flight_id","checklist_id","step_id",
                "event_type","actor_id","registered_by","source","actual_time","registered_at","reason","source_ref",
                "corrects_reserve_record_id")) {
            out.put(col,rs.getObject(col));
        }
        out.put("data",json.map(rs.getString("data_json")));
        return out;
    }

    /** Decisions are append-only. A later decision must explicitly supersede the last one. */
    @PostMapping("/reserve-records/{id}/reconciliations")
    @Transactional
    public ResponseEntity<ActionResult> decide(@PathVariable UUID id,@RequestBody ReconcileRequest request,Principal principal) {
        if(request==null || request.operationId()==null || !validReason(request.reason())
                || (request.classification()==null || !List.of("DUPLICATE","UNIQUE","CONFLICT").contains(request.classification()))
                || (request.decision()==null || !List.of("MARK_DUPLICATE","REQUEST_CORE_REVIEW","REJECT","ESCALATE").contains(request.decision()))
                || ("UNIQUE".equals(request.classification()) != (request.matchedAuditId()==null))
                || ("MARK_DUPLICATE".equals(request.decision()) && !"DUPLICATE".equals(request.classification()))) {
            throw new ApiException(HttpStatus.BAD_REQUEST,"Invalid reconciliation decision");
        }
        String registrar=principal.getName();
        Map<String,Object> canonical=new HashMap<>();
        canonical.put("reserve_record_id",id);
        canonical.put("classification",request.classification());
        canonical.put("decision",request.decision());
        canonical.put("matched_audit_id",request.matchedAuditId());
        canonical.put("reason",request.reason());
        canonical.put("supersedes_id",request.supersedesId());
        canonical.put("resolved_by",registrar);
        String hash=JsonSupport.sha256(json.text(CanonicalJson.sort(canonical)));
        jdbc.queryForList(
            "SELECT pg_advisory_xact_lock(hashtextextended(?::text, 0))",
            id.toString());
        var originals=jdbc.queryForList(
            "SELECT reserve_record_id FROM reserve_record WHERE reserve_record_id=?",id);
        if(originals.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND,"Reserve record not found");
        var repeats=jdbc.queryForList("""
            SELECT reconciliation_id,request_sha256 FROM reconciliation WHERE resolved_by=? AND operation_id=?
            """,registrar,request.operationId());
        if(!repeats.isEmpty()) {
            var original=repeats.getFirst();
            if(!hash.equals(original.get("request_sha256")))
                throw new ApiException(HttpStatus.CONFLICT,"operation_id reused with different decision");
            return ResponseEntity.ok(new ActionResult("DUPLICATE",(UUID)original.get("reconciliation_id")));
        }
        var previous=jdbc.queryForList("""
            SELECT reconciliation_id FROM reconciliation WHERE reserve_record_id=?
            ORDER BY resolved_at DESC,reconciliation_id DESC LIMIT 1
            """,id);
        UUID last=previous.isEmpty()?null:(UUID)previous.getFirst().get("reconciliation_id");
        if(!java.util.Objects.equals(last,request.supersedesId())) {
            throw new ApiException(HttpStatus.CONFLICT,"supersedes_id must reference latest decision");
        }
        if(request.matchedAuditId()!=null) {
            var matches=jdbc.queryForList("""
                SELECT a.checklist_id,a.step_id,a.actor_id,(%s) AS action,
                       r.checklist_id AS reserve_checklist_id,r.step_id AS reserve_step_id,
                       r.actor_id AS reserve_actor_id,r.event_type AS reserve_event_type
                FROM audit_event a CROSS JOIN reserve_record r
                WHERE a.audit_id=? AND r.reserve_record_id=? AND a.producer_service='CORE'
                """.formatted(CoreAuditAction.ALIASED_SQL),request.matchedAuditId(),id);
            if(matches.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST,"Matched CORE event not found");
            var match=matches.getFirst();
            if(!java.util.Objects.equals(match.get("checklist_id"),match.get("reserve_checklist_id"))
                    || !java.util.Objects.equals(match.get("step_id"),match.get("reserve_step_id"))) {
                throw new ApiException(HttpStatus.BAD_REQUEST,"Matched event belongs to another checklist/step");
            }
            if("DUPLICATE".equals(request.classification())
                    && (!java.util.Objects.equals(match.get("actor_id"),match.get("reserve_actor_id"))
                      || !java.util.Objects.equals(match.get("action"),match.get("reserve_event_type")))) {
                throw new ApiException(HttpStatus.BAD_REQUEST,"Duplicate must match actor and action");
            }
        }
        UUID decisionId=UUID.randomUUID();
        jdbc.update("""
            INSERT INTO reconciliation(reconciliation_id,reserve_record_id,operation_id,request_sha256,
              classification,decision,matched_audit_id,reason,resolved_by,supersedes_id)
            VALUES(?,?,?,?,?,?,?,?,?,?)
            """,decisionId,id,request.operationId(),hash,request.classification(),request.decision(),
                request.matchedAuditId(),request.reason(),registrar,request.supersedesId());
        return ResponseEntity.status(HttpStatus.CREATED).body(new ActionResult("CREATED",decisionId));
    }
    private static boolean validId(String value) {
        return value!=null && !value.isBlank() && value.length()<=256;
    }
    private static boolean validType(String value) {
        return value!=null && value.matches("[A-Za-z][A-Za-z0-9_.-]{0,127}");
    }
    private static boolean validReason(String value) {
        return value!=null && !value.isBlank() && value.trim().length()>=3 && value.length()<=2000;
    }
}
