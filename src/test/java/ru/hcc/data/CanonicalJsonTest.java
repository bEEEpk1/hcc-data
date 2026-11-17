package ru.hcc.data;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import ru.hcc.data.common.CanonicalJson;
import static org.junit.jupiter.api.Assertions.*;

class CanonicalJsonTest {
    @Test void recursiveKeyOrderIsDeterministic() {
        Object first=CanonicalJson.sort(Map.of("z",List.of(Map.of("b",2,"a",1)),"a",true));
        Object second=CanonicalJson.sort(Map.of("a",true,"z",List.of(Map.of("a",1,"b",2))));
        assertEquals(first,second);
    }
}
