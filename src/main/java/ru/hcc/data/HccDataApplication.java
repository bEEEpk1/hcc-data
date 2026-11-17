package ru.hcc.data;

import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SecurityScheme(name="dataBearer", type=SecuritySchemeType.HTTP, scheme="bearer")
@SpringBootApplication(scanBasePackages = {"ru.hcc.data"})
public class HccDataApplication {
    public static void main(String[] args) {
        SpringApplication.run(HccDataApplication.class, args);
    }
}
