package in.addabaaz.user;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import in.addabaaz.security.AppUserDetails;
import in.addabaaz.user.dto.AuthResponse;
import in.addabaaz.user.dto.LoginRequest;
import in.addabaaz.user.dto.RefreshRequest;
import in.addabaaz.user.dto.RegisterRequest;
import in.addabaaz.user.dto.UserDto;
import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api/auth")
@Validated
public class AuthController {

  private final AuthService authService;
  private final JwtTokenResponseFactory responses;

  public AuthController(AuthService authService, JwtTokenResponseFactory responses) {
    this.authService = authService;
    this.responses = responses;
  }

  @PostMapping("/register")
  ResponseEntity<AuthResponse> register(
      @Validated @RequestBody RegisterRequest request, HttpServletRequest httpRequest) {
    AppUser user = authService.register(request);
    return ResponseEntity.status(HttpStatus.CREATED).body(responses.forUser(user, httpRequest));
  }

  @PostMapping("/login")
  ResponseEntity<AuthResponse> login(
      @Validated @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
    AppUser user = authService.login(request);
    return ResponseEntity.ok(responses.forUser(user, httpRequest));
  }

  @PostMapping("/refresh")
  ResponseEntity<AuthResponse> refresh(
      @Validated @RequestBody RefreshRequest request, HttpServletRequest httpRequest) {
    AuthService.Rotation rotation = authService.rotateRefreshToken(request.refreshToken(), httpRequest);
    return ResponseEntity.ok(
        AuthResponse.of(
            responses.accessToken(rotation.user()),
            rotation.refreshToken(),
            authService.accessTokenTtlSeconds(),
            UserDto.from(rotation.user())));
  }

  @PostMapping("/logout")
  ResponseEntity<Void> logout(@RequestBody(required = false) RefreshRequest request) {
    if (request != null && request.refreshToken() != null) {
      authService.revokeRefreshToken(request.refreshToken());
    }
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/logout-all")
  ResponseEntity<Void> logoutAll(@AuthenticationPrincipal AppUserDetails principal) {
    authService.revokeAllFor(principal.getUser().getId());
    return ResponseEntity.noContent().build();
  }

  /** Where the Angular app should send the browser for "Continue with Google". */
  @GetMapping("/google")
  ResponseEntity<java.util.Map<String, String>> google() {
    return ResponseEntity.ok(java.util.Map.of("url", "/oauth2/authorization/google"));
  }
}
