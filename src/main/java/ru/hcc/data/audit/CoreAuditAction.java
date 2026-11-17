package ru.hcc.data.audit;

/** CORE's audit.log envelope carries the business action inside the original payload. */
public final class CoreAuditAction {
    public static final String SQL = expression("");
    public static final String ALIASED_SQL = expression("a.");

    private CoreAuditAction() {}

    private static String expression(String columnPrefix) {
        return """
            CASE WHEN %1$sevent_type='audit.log' AND jsonb_typeof(%1$spayload #> '{data,action}')='string'
            THEN COALESCE(NULLIF(%1$spayload #>> '{data,action}', ''), %1$sevent_type) ELSE %1$sevent_type END
            """.formatted(columnPrefix);
    }
}
