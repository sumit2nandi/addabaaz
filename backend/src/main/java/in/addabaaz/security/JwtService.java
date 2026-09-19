package in.addabaaz.security;

import java.time.Instant;
import java.util.List;

import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

import in.addabaaz.config.AddabaazProperties;
import in.addabaaz.user.AppUser;
import in.addabaaz.user.Role;

/** Issues short-lived signed access tokens. Refresh tokens are opaque and live in the DB. */
@Service
public class JwtService {

  private final JwtEncoder encoder;
  private final AddabaazProperties properties;

  public JwtService(JwtEncoder encoder, AddabaazProperties properties) {
    this.encoder = encoder;
    this.properties = properties;
  }

  public String createAccessToken(AppUser user) {
    Instant now = Instant.now();
    List<String> roles = user.getRoles().stream().map(Role::getCode).toList();

    JwtClaimsSet claims =
        JwtClaimsSet.builder()
            .issuer(properties.getJwt().getIssuer())
            .subject(user.getId().toString())
            .issuedAt(now)
            .expiresAt(now.plus(properties.getJwt().getAccessTokenTtl()))
            .claim("email", user.getEmail())
            .claim("name", user.getFullName())
            .claim("roles", roles)
            .build();

    return encoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();
  }

  public long accessTokenTtlSeconds() {
    return properties.getJwt().getAccessTokenTtl().toSeconds();
  }
}
