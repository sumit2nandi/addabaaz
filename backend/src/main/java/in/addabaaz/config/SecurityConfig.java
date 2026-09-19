package in.addabaaz.config;

import java.util.List;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jose.jws.ImmutableSecret;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import in.addabaaz.security.AppUserDetailsService;
import in.addabaaz.security.JwtAuthenticationFilter;
import in.addabaaz.security.OAuth2LoginSuccessHandler;
import in.addabaaz.user.UserRepository;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

  /** Content that anybody (including not-yet-signed-in visitors) may read. */
  private static final String[] PUBLIC_GET = {
    "/", "/error",
    "/api/health",
    "/api/auth/google",
    "/api/home",
    "/api/shows", "/api/shows/**",
    "/api/episodes/**",
    "/api/promos", "/api/promos/**",
    "/api/posters", "/api/posters/**",
    "/api/banners",
    "/api/team",
    "/api/services",
    "/api/settings", "/api/settings/**",
    "/api/plans", "/api/plans/**",
    "/api/reviews", "/api/reviews/**",
    "/api/ratings/**",
    "/api/captcha/**"
  };

  private static final String[] PUBLIC_POST = {
    "/api/auth/register", "/api/auth/login", "/api/auth/refresh", "/api/auth/google",
    "/api/contact/inquiries"
  };

  @Bean
  SecretKey jwtSecretKey(AddabaazProperties properties) {
    byte[] bytes = properties.getJwt().getSecret().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    if (bytes.length < 32) {
      throw new IllegalStateException(
          "addabaaz.jwt.secret must be at least 32 bytes for HS256");
    }
    return new SecretKeySpec(bytes, "HmacSHA256");
  }

  @Bean
  JwtEncoder jwtEncoder(SecretKey key) {
    return new NimbusJwtEncoder(new ImmutableSecret<>(key));
  }

  @Bean
  JwtDecoder jwtDecoder(SecretKey key) {
    return NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
  }

  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
  }

  @Bean
  AppUserDetailsService userDetailsService(UserRepository users) {
    return new AppUserDetailsService(users);
  }

  @Bean
  CorsConfigurationSource corsConfigurationSource(AddabaazProperties properties) {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOrigins(properties.getCors().getAllowedOrigins());
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
    config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "X-Requested-With"));
    config.setExposedHeaders(List.of("Authorization"));
    config.setAllowCredentials(true);
    config.setMaxAge(3600L);

    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    return source;
  }

  @Bean
  SecurityFilterChain filterChain(
      HttpSecurity http,
      JwtAuthenticationFilter jwtAuthenticationFilter,
      OAuth2LoginSuccessHandler oauthSuccessHandler,
      AddabaazProperties properties)
      throws Exception {

    http
        .cors(Customizer.withDefaults())
        .csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(
            session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
        .authorizeHttpRequests(
            auth ->
                auth
                    .requestMatchers(HttpMethod.GET, PUBLIC_GET).permitAll()
                    .requestMatchers(HttpMethod.POST, PUBLIC_POST).permitAll()
                    .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                    .requestMatchers("/api/admin/**").hasRole("ADMIN")
                    .anyRequest().authenticated())
        .oauth2Login(
            oauth ->
                oauth
                    .successHandler(oauthSuccessHandler)
                    .failureHandler(
                        (request, response, exception) ->
                            response.sendRedirect(
                                properties.getFrontend().getBaseUrl()
                                    + "/oauth2/callback?error=google_signin_failed")))
        .exceptionHandling(
            handling ->
                handling
                    .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED))
                    .accessDeniedHandler(
                        (request, response, denied) ->
                            response.setStatus(HttpStatus.FORBIDDEN.value())))
        .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

    return http.build();
  }
}
