FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml ./
COPY src ./src
RUN mvn -B -ntp clean verify
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 hcc
COPY --from=build /workspace/target/hcc-data-service-1.0.0.jar /app/app.jar
USER hcc
EXPOSE 8090
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
