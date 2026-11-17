-- HCC DATA: fresh installation, one baseline schema. Execute as hcc_migrator.
SET search_path TO hcc_data;

CREATE TABLE inbound_event (
    inbound_id UUID PRIMARY KEY,
    producer_service VARCHAR(16) NOT NULL CHECK (producer_service IN ('CORE','AUTH')),
    source_event_id UUID NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    event_body JSONB NOT NULL CHECK (jsonb_typeof(event_body) = 'object'),
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT inbound_source_unique UNIQUE (producer_service, source_event_id)
);
CREATE INDEX inbound_received_idx ON inbound_event (received_at DESC);

CREATE TABLE audit_event (
    audit_id UUID PRIMARY KEY,
    producer_service VARCHAR(16) NOT NULL,
    source_event_id UUID NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    actual_time TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    correlation_id UUID,
    causation_id UUID,
    operation_id UUID,
    flight_id TEXT,
    checklist_id TEXT,
    step_id TEXT,
    actor_id TEXT,
    subject_user_id TEXT,
    registered_by TEXT,
    source VARCHAR(24) NOT NULL CHECK (source IN ('CORE','AUTH','PHONE','BACKUP_JOURNAL')),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT audit_source_unique UNIQUE (producer_service, source_event_id),
    CONSTRAINT audit_inbound_fk FOREIGN KEY (producer_service,source_event_id)
        REFERENCES inbound_event (producer_service,source_event_id) ON DELETE RESTRICT
);
CREATE INDEX audit_received_idx ON audit_event (received_at DESC, audit_id DESC);
CREATE INDEX audit_occurred_idx ON audit_event (occurred_at DESC, audit_id DESC);
CREATE INDEX audit_actor_idx ON audit_event (actor_id, occurred_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX audit_subject_idx ON audit_event (subject_user_id, occurred_at DESC) WHERE subject_user_id IS NOT NULL;
CREATE INDEX audit_flight_idx ON audit_event (flight_id, occurred_at DESC) WHERE flight_id IS NOT NULL;
CREATE INDEX audit_checklist_step_idx ON audit_event (checklist_id, step_id, occurred_at DESC);
CREATE INDEX audit_event_type_idx ON audit_event (event_type, occurred_at DESC);
CREATE INDEX audit_correlation_idx ON audit_event (correlation_id) WHERE correlation_id IS NOT NULL;

-- Source facts entered while ordinary recording was unavailable.
CREATE TABLE reserve_record (
    reserve_record_id UUID PRIMARY KEY,
    operation_id UUID NOT NULL,
    request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    flight_id TEXT,
    checklist_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    actor_id TEXT NOT NULL,
    registered_by TEXT NOT NULL,
    source VARCHAR(24) NOT NULL CHECK (source IN ('PHONE','BACKUP_JOURNAL')),
    actual_time TIMESTAMPTZ NOT NULL,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 2000),
    source_ref TEXT,
    data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    corrects_reserve_record_id UUID REFERENCES reserve_record(reserve_record_id) ON DELETE RESTRICT,
    CONSTRAINT reserve_request_unique UNIQUE (registered_by, operation_id),
    CONSTRAINT reserve_journal_ref CHECK (source <> 'BACKUP_JOURNAL' OR NULLIF(trim(source_ref),'') IS NOT NULL)
);
CREATE INDEX reserve_checklist_idx ON reserve_record (checklist_id,step_id,registered_at DESC);
CREATE INDEX reserve_actor_idx ON reserve_record (actor_id,registered_at DESC);
CREATE INDEX reserve_correction_idx ON reserve_record (corrects_reserve_record_id)
    WHERE corrects_reserve_record_id IS NOT NULL;

-- Append-only decisions; correcting a decision means a new row with supersedes_id.
CREATE TABLE reconciliation (
    reconciliation_id UUID PRIMARY KEY,
    reserve_record_id UUID NOT NULL REFERENCES reserve_record(reserve_record_id) ON DELETE RESTRICT,
    operation_id UUID NOT NULL,
    request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    classification VARCHAR(16) NOT NULL CHECK (classification IN ('DUPLICATE','UNIQUE','CONFLICT')),
    decision VARCHAR(32) NOT NULL CHECK (decision IN ('MARK_DUPLICATE','REQUEST_CORE_REVIEW','REJECT','ESCALATE')),
    matched_audit_id UUID REFERENCES audit_event(audit_id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 2000),
    resolved_by TEXT NOT NULL,
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    supersedes_id UUID REFERENCES reconciliation(reconciliation_id) ON DELETE RESTRICT,
    CONSTRAINT reconciliation_op_unique UNIQUE (resolved_by,operation_id),
    CONSTRAINT reconciliation_supersedes_once UNIQUE (supersedes_id),
    CONSTRAINT reconciliation_match CHECK ((classification = 'UNIQUE' AND matched_audit_id IS NULL)
               OR (classification IN ('DUPLICATE','CONFLICT') AND matched_audit_id IS NOT NULL)),
    CONSTRAINT reconciliation_duplicate_decision_check CHECK (decision <> 'MARK_DUPLICATE' OR classification = 'DUPLICATE'),
    CONSTRAINT reconciliation_no_self_ref CHECK (supersedes_id IS NULL OR supersedes_id <> reconciliation_id)
);
CREATE INDEX reconciliation_by_reserve_idx ON reconciliation (reserve_record_id,resolved_at DESC);

-- Stores safe metadata for poison messages. Raw payload stays in Kafka until retention;
-- credentials/OTP must never be copied to quarantine tables.
CREATE TABLE ingest_failure (
    failure_id UUID PRIMARY KEY,
    topic TEXT NOT NULL,
    partition_no INTEGER NOT NULL,
    offset_no BIGINT NOT NULL,
    content_sha256 CHAR(64) NOT NULL,
    reason_code VARCHAR(40) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT failure_position_unique UNIQUE (topic,partition_no,offset_no)
);
CREATE INDEX failure_received_idx ON ingest_failure(received_at DESC);

CREATE FUNCTION reject_history_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Immutable history: % on % is prohibited', TG_OP, TG_TABLE_NAME
        USING ERRCODE = '42501';
END $$;

CREATE TRIGGER inbound_immutable BEFORE UPDATE OR DELETE ON inbound_event
  FOR EACH ROW EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER reserve_immutable BEFORE UPDATE OR DELETE ON reserve_record
  FOR EACH ROW EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER reconciliation_immutable BEFORE UPDATE OR DELETE ON reconciliation
  FOR EACH ROW EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER failure_immutable BEFORE UPDATE OR DELETE ON ingest_failure
  FOR EACH ROW EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER inbound_no_truncate BEFORE TRUNCATE ON inbound_event
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER reserve_no_truncate BEFORE TRUNCATE ON reserve_record
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER reconciliation_no_truncate BEFORE TRUNCATE ON reconciliation
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();
CREATE TRIGGER failure_no_truncate BEFORE TRUNCATE ON ingest_failure
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change();

-- Service identity may insert/read facts but cannot update, delete, truncate or alter them.
GRANT USAGE ON SCHEMA hcc_data TO hcc_app;
GRANT SELECT, INSERT ON inbound_event, audit_event, reserve_record, reconciliation, ingest_failure TO hcc_app;
