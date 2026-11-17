package ru.hcc.data.common;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;

public final class CanonicalJson {
    private CanonicalJson() {}
    public static Object sort(Object obj) {
        if (obj instanceof Map<?, ?> map) {
            Map<String,Object> sorted = new TreeMap<>();
            map.forEach((key,value) -> sorted.put(String.valueOf(key), sort(value)));
            return sorted;
        }
        if (obj instanceof List<?> list) return list.stream().map(CanonicalJson::sort).toList();
        return obj;
    }
}
