package ru.hcc.data.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain security(HttpSecurity http,
            @Value("${hcc.security.mode:jwt}") String mode,
            @Value("${hcc.security.demo.supervisor-token:}") String supervisor,
            @Value("${hcc.security.demo.auditor-token:}") String auditor) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable);
        http.sessionManagement(cfg -> cfg.sessionCreationPolicy(
                org.springframework.security.config.http.SessionCreationPolicy.STATELESS));
        http.authorizeHttpRequests(a -> a
                .requestMatchers(
                        "/swagger-ui.html",
                        "/swagger-ui/**",
                        "/v3/api-docs/**"
                ).permitAll()
            .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
            .requestMatchers("/actuator/health", "/actuator/info").permitAll()
            .requestMatchers(HttpMethod.GET,"/api/audit/security", "/api/ingest-failures")
                .hasAuthority("SCOPE_security_audit.read")
            .requestMatchers(HttpMethod.GET,"/api/audit","/api/statistics/**")
                .hasAuthority("SCOPE_audit.read")
            .requestMatchers(HttpMethod.POST,"/api/reserve-records","/api/reserve-records/{id}/reconciliations")
                .hasAuthority("SCOPE_recovery.manage")
            .requestMatchers(HttpMethod.GET,"/api/reserve-records","/api/reserve-records/*")
                .hasAuthority("SCOPE_recovery.read")
            .anyRequest().denyAll());
        if("demo".equals(mode)) {
            if(supervisor.length()<24 || auditor.length()<24 || supervisor.equals(auditor))
                throw new IllegalStateException("Two distinct demo secrets of >=24 characters required");
            http.addFilterBefore(new DemoFilter(supervisor,auditor),UsernamePasswordAuthenticationFilter.class);
        } else if("jwt".equals(mode)) {
            http.oauth2ResourceServer(oauth -> oauth.jwt(Customizer.withDefaults()));
        } else throw new IllegalStateException("Unsupported hcc.security.mode");
        return http.build();
    }
    private static class DemoFilter extends OncePerRequestFilter {
        private final String supervisor,auditor;
        DemoFilter(String supervisor,String auditor) {this.supervisor=supervisor;this.auditor=auditor;}
        private static boolean match(String a,String b) {
            return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),
                b.getBytes(StandardCharsets.UTF_8));
        }
        @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,
                FilterChain chain) throws ServletException,IOException {
            String header=request.getHeader("Authorization");
            if(header!=null && header.startsWith("Bearer ")) {
                String token=header.substring(7);
                String identity=null;
                List<String> scopes=List.of();
                if(match(token,supervisor)) {
                    identity="demo-supervisor";
                    scopes=List.of("recovery.manage","recovery.read","audit.read");
                } else if(match(token,auditor)) {
                    identity="demo-auditor";
                    scopes=List.of("recovery.read","audit.read","security_audit.read");
                }
                if(identity!=null) {
                    var authorities=scopes.stream().map(s->new SimpleGrantedAuthority("SCOPE_"+s)).toList();
                    SecurityContextHolder.getContext().setAuthentication(
                        new UsernamePasswordAuthenticationToken(identity,null,authorities));
                }
            }
            chain.doFilter(request,response);
        }
    }
}
