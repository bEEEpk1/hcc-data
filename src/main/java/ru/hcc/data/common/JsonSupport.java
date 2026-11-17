package ru.hcc.data.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import org.postgresql.util.PGobject;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.stereotype.Component;

@Component
public class JsonSupport {
    private final JsonMapper mapper;
    public JsonSupport(JsonMapper mapper) { this.mapper = mapper; }
    public String text(Object value) { return mapper.writeValueAsString(value); }
    @SuppressWarnings("unchecked")
    public Map<String,Object> map(String json) { return mapper.readValue(json, Map.class); }
    public <T> T parse(String json, Class<T> type) { return mapper.readValue(json, type); }
    public PGobject jsonb(Object value) {
        try {
            PGobject object = new PGobject();
            object.setType("jsonb");
            object.setValue(text(value));
            return object;
        } catch (java.sql.SQLException e) { throw new IllegalStateException(e); }
    }
    public static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                 .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
