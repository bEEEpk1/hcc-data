package ru.hcc.data.events;

import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import ru.hcc.data.common.JsonSupport;

@Service
public class IngestFailureService {
    private final JdbcTemplate jdbc;
    public IngestFailureService(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    /** In a separate transaction: failed ingestion may have rolled back. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void quarantine(ConsumerRecord<String,String> record, String code) {
        jdbc.update("""
            INSERT INTO ingest_failure(failure_id,topic,partition_no,offset_no,content_sha256,reason_code)
            VALUES(?,?,?,?,?,?) ON CONFLICT(topic,partition_no,offset_no) DO NOTHING
            """,UUID.randomUUID(),record.topic(),record.partition(),record.offset(),
            JsonSupport.sha256(String.valueOf(record.value())),code);
    }
}
