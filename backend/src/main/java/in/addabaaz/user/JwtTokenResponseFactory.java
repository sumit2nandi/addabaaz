package in.addabaaz.user;

import org.springframework.stereotype.Component;

import in.addabaaz.security.JwtService;
import in.addabaaz.user.dto.AuthResponse;
import in.addabaaz.user.dto.UserDto;
import jakarta.servlet.http.HttpServletRequest;

/** Builds the {accessToken, refreshToken, user} payload shared by login/register/refresh. */
@Component
public class JwtTokenResponseFactory {

  private final JwtService jwtService;
  private final AuthService authService;

  public JwtTokenResponseFactory(JwtService jwtService, AuthService authService) {
    this.jwtService = jwtService;
    this.authService = authService;
  }

  public String accessToken(AppUser user) {
    return jwtService.createAccessToken(user);
  }

  public AuthResponse forUser(AppUser user, HttpServletRequest request) {
    return AuthResponse.of(
        jwtService.createAccessToken(user),
        authService.issueRefreshToken(user, request),
        authService.accessTokenTtlSeconds(),
        UserDto.from(user));
  }
}
