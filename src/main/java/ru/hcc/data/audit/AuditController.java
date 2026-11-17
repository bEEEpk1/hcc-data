package ru.hcc.data.audit;

import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import ru.hcc.data.common.ApiException;
import ru.hcc.data.common.JsonSupport;

@SecurityRequirement(name="dataBearer")
@RestController
@RequestMapping("/api")
public class AuditController {
    private final JdbcTemplate jdbc;
    private final JsonSupport json;
    public AuditController(JdbcTemplate jdbc, JsonSupport json) {this.jdbc=jdbc;this.json=json;}
    @GetMapping("/audit")
    public List<Map<String,Object>> audit(
            @RequestParam(required=false) String flightId,
            @RequestParam(required=false) String checklistId,
            @RequestParam(required=false) String stepId,
            @RequestParam(required=false) String actorId,
            @RequestParam(required=false) String eventType,
            @RequestParam(required=false) String producerService,
            @RequestParam(required=false) String action,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue="100") int limit,
            @RequestParam(defaultValue="0") int offset) {
        return query(false,flightId,checklistId,stepId,actorId,null,eventType,producerService,
                action,from,to,limit,offset);
    }
    @GetMapping("/audit/security")
    public List<Map<String,Object>> security(
            @RequestParam(required=false) String actorId,
            @RequestParam(required=false) String subjectUserId,
            @RequestParam(required=false) String eventType,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue="100") int limit,
            @RequestParam(defaultValue="0") int offset) {
        return query(true,null,null,null,actorId,subjectUserId,eventType,"AUTH",null,from,to,limit,offset);
    }
    private List<Map<String,Object>> query(boolean security,String flight,String checklist,String step,
            String actor,String subject,String type,String producer,String action,Instant from,Instant to,int limit,int offset) {
        if(limit<1 || limit>500 || offset<0 || offset>100000)
            throw new ApiException(HttpStatus.BAD_REQUEST,"Invalid pagination");
        if(from!=null && to!=null && from.isAfter(to))
            throw new ApiException(HttpStatus.BAD_REQUEST,"from must be <= to");
        StringBuilder sql=new StringBuilder("""
            SELECT audit_id,producer_service,source_event_id,event_type,occurred_at,actual_time,received_at,
                correlation_id,causation_id,operation_id,flight_id,checklist_id,step_id,actor_id,
                subject_user_id,registered_by,source,payload::text AS payload_json
            FROM audit_event WHERE
            """).append(security?" producer_service='AUTH'":" producer_service='CORE'");
        List<Object> args=new ArrayList<>();
        add(sql,args,"flight_id",flight);add(sql,args,"checklist_id",checklist);
        add(sql,args,"step_id",step);add(sql,args,"actor_id",actor);
        add(sql,args,"subject_user_id",subject);add(sql,args,"event_type",type);
        if(action!=null && !action.isBlank()) { sql.append(" AND (").append(CoreAuditAction.SQL).append(")=?"); args.add(action); }
        // In ordinary audit the producer is deliberately restricted to CORE, regardless of caller input.
        if(producer!=null && !(security?"AUTH":"CORE").equals(producer)) return List.of();
        if(from!=null){sql.append(" AND occurred_at>=?");args.add(Timestamp.from(from));}
        if(to!=null){sql.append(" AND occurred_at<=?");args.add(Timestamp.from(to));}
        sql.append(" ORDER BY received_at DESC,audit_id DESC LIMIT ? OFFSET ?");
        args.add(limit);args.add(offset);
        return jdbc.query(sql.toString(),(rs,i)->{
            Map<String,Object> item=new HashMap<>();
            for(String col:List.of("audit_id","producer_service","source_event_id","event_type","occurred_at",
                 "actual_time","received_at","correlation_id","causation_id","operation_id","flight_id",
                 "checklist_id","step_id","actor_id","subject_user_id","registered_by","source")) {
                item.put(col,rs.getObject(col));
            }
            item.put("payload",json.map(rs.getString("payload_json")));
            return item;
        },args.toArray());
    }
    private static void add(StringBuilder sql,List<Object> args,String column,String value) {
        if(value!=null && !value.isBlank()) {sql.append(" AND ").append(column).append("=?");args.add(value);}
    }
    @GetMapping("/statistics/actors/{actorId}")
    public Map<String,Object> actor(@PathVariable String actorId,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE_TIME) Instant to) {
        return aggregate("actor_id",actorId,from,to);
    }
    @GetMapping("/statistics/flights/{flightId}")
    public Map<String,Object> flight(@PathVariable String flightId,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE_TIME) Instant to) {
        return aggregate("flight_id",flightId,from,to);
    }
    private Map<String,Object> aggregate(String key,String value,Instant from,Instant to) {
        if(value.isBlank() || (from!=null && to!=null && from.isAfter(to)))
            throw new ApiException(HttpStatus.BAD_REQUEST,"Invalid filter");
        StringBuilder sql=new StringBuilder("""
            WITH filtered AS (
                SELECT event_type,(%s) AS action FROM audit_event WHERE producer_service='CORE' AND %s=?
            """.formatted(CoreAuditAction.SQL,key));
        List<Object> args=new ArrayList<>();
        args.add(value);
        if(from!=null){sql.append(" AND occurred_at>=?");args.add(Timestamp.from(from));}
        if(to!=null){sql.append(" AND occurred_at<=?");args.add(Timestamp.from(to));}
        sql.append("""
            )
            SELECT event_type,action,COUNT(*) AS count
            FROM filtered GROUP BY GROUPING SETS ((event_type),(action))
            ORDER BY count DESC,COALESCE(action,event_type)
            """);
        List<Map<String,Object>> byType=new ArrayList<>();
        List<Map<String,Object>> byAction=new ArrayList<>();
        long total=0;
        for(var group : jdbc.queryForList(sql.toString(),args.toArray())) {
            Number count=(Number)group.get("count");
            if(group.get("action")!=null) {
                byAction.add(Map.of("action",group.get("action"),"count",count));
            } else {
                byType.add(Map.of("event_type",group.get("event_type"),"count",count));
                total+=count.longValue();
            }
        }
        return Map.of("group_by",key,"id",value,"total_events",total,"by_type",byType,"by_action",byAction);
    }
    @GetMapping("/ingest-failures")
    public List<Map<String,Object>> failures(@RequestParam(defaultValue="100") int limit) {
        if(limit<1 || limit>500) throw new ApiException(HttpStatus.BAD_REQUEST,"Invalid pagination");
        return jdbc.queryForList("""
            SELECT failure_id,topic,partition_no,offset_no,content_sha256,reason_code,received_at
            FROM ingest_failure ORDER BY received_at DESC LIMIT ?
            """,limit);
    }
}
