package in.addabaaz.security;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import in.addabaaz.user.AppUser;
import in.addabaaz.user.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/** Turns a valid `Authorization: Bearer <jwt>` header into an authenticated context. */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

  private final JwtDecoder decoder;
  private final UserRepository users;

  public JwtAuthenticationFilter(JwtDecoder decoder, UserRepository users) {
    this.decoder = decoder;
    this.users = users;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {

    String header = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (header != null && header.startsWith("Bearer ")) {
      try {
        Jwt jwt = decoder.decode(header.substring(7));
        UUID userId = UUID.fromString(jwt.getSubject());
        AppUser user = users.findById(userId).orElse(null);
        if (user != null && user.getStatus() == AppUser.Status.ACTIVE) {
          var authorities =
              AppUserDetails.roles(user).stream()
                  .map(SimpleGrantedAuthority::new)
                  .map(GrantedAuthority.class::cast)
                  .toList();
          var authentication =
              new UsernamePasswordAuthenticationToken(
                  new AppUserDetails(user), null, authorities);
          authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
          SecurityContextHolder.getContext().setAuthentication(authentication);
        }
      } catch (JwtException | IllegalArgumentException e) {
        SecurityContextHolder.clearContext();
      }
    }

    chain.doFilter(request, response);
  }
}
