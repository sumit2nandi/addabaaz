package in.addabaaz.security;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Optional;

import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import in.addabaaz.config.AddabaazProperties;
import in.addabaaz.user.AppUser;
import in.addabaaz.user.AuthService;
import in.addabaaz.user.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * After Google signs the user in we create (or reuse) the local account, mint a token pair and
 * bounce the browser back to the Angular app, which exchanges the tokens for a session.
 */
@Component
public class OAuth2LoginSuccessHandler implements AuthenticationSuccessHandler {

  private final UserRepository users;
  private final AuthService authService;
  private final JwtService jwtService;
  private final AddabaazProperties properties;

  public OAuth2LoginSuccessHandler(
      UserRepository users, AuthService authService, JwtService jwtService,
      AddabaazProperties properties) {
    this.users = users;
    this.authService = authService;
    this.jwtService = jwtService;
    this.properties = properties;
  }

  @Override
  public void onAuthenticationSuccess(
      HttpServletRequest request, HttpServletResponse response, Authentication authentication)
      throws IOException {

    OAuth2AuthenticationToken oauth = (OAuth2AuthenticationToken) authentication;
    OAuth2User principal = oauth.getPrincipal();

    String providerId = String.valueOf(principal.getAttribute("sub"));
    String email = Optional.ofNullable(principal.<String>getAttribute("email"))
        .orElseGet(() -> providerId + "@google.local");
    String name = Optional.ofNullable(principal.<String>getAttribute("name")).orElse(email);
    String avatar = principal.getAttribute("picture");

    AppUser user = authService.findOrCreateOAuthUser(
        AppUser.AuthProvider.GOOGLE, providerId, email, name, avatar);

    String accessToken = jwtService.createAccessToken(user);
    String refreshToken = authService.issueRefreshToken(user, request);

    String target =
        properties.getFrontend().getBaseUrl()
            + "/oauth2/callback?accessToken="
            + URLEncoder.encode(accessToken, StandardCharsets.UTF_8)
            + "&refreshToken="
            + URLEncoder.encode(refreshToken, StandardCharsets.UTF_8);

    response.sendRedirect(target);
  }
}
