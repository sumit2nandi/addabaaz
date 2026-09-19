package in.addabaaz.user;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.common.BadRequestException;
import in.addabaaz.common.ConflictException;
import in.addabaaz.common.HashSupport;
import in.addabaaz.common.NotFoundException;
import in.addabaaz.config.AddabaazProperties;
import in.addabaaz.engagement.ProfileService;
import in.addabaaz.security.AppUserDetails;
import in.addabaaz.security.JwtService;
import in.addabaaz.user.dto.LoginRequest;
import in.addabaaz.user.dto.RegisterRequest;
import jakarta.servlet.http.HttpServletRequest;

/** Registration, login, token rotation and Google sign-in. */
@Service
@Transactional
public class AuthService {

  private static final String ROLE_USER = "ROLE_USER";

  private final UserRepository users;
  private final RoleRepository roles;
  private final RefreshTokenRepository refreshTokens;
  private final PasswordEncoder passwordEncoder;
  private final AuthenticationManager authenticationManager;
  private final JwtService jwtService;
  private final ProfileService profileService;
  private final AddabaazProperties properties;

  public AuthService(
      UserRepository users,
      RoleRepository roles,
      RefreshTokenRepository refreshTokens,
      PasswordEncoder passwordEncoder,
      AuthenticationManager authenticationManager,
      JwtService jwtService,
      ProfileService profileService,
      AddabaazProperties properties) {
    this.users = users;
    this.roles = roles;
    this.refreshTokens = refreshTokens;
    this.passwordEncoder = passwordEncoder;
    this.authenticationManager = authenticationManager;
    this.jwtService = jwtService;
    this.profileService = profileService;
    this.properties = properties;
  }

  // ---------------------------------------------------------------- registration

  public AppUser register(RegisterRequest request) {
    String email = request.email().trim().toLowerCase();
    if (users.existsByEmailIgnoreCase(email)) {
      throw new ConflictException("An account with that email already exists.");
    }

    AppUser user = new AppUser();
    user.setEmail(email);
    user.setPasswordHash(passwordEncoder.encode(request.password()));
    user.setFullName(blankToNull(request.fullName()));
    user.setPhone(blankToNull(request.phone()));
    user.setAuthProvider(AppUser.AuthProvider.LOCAL);
    user.setRoles(Set.of(requireRole(ROLE_USER)));

    AppUser saved = users.save(user);
    profileService.createDefaultProfile(saved);
    return saved;
  }

  // ---------------------------------------------------------------------- login

  public AppUser login(LoginRequest request) {
    Authentication authentication =
        authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(
                request.email().trim().toLowerCase(), request.password()));

    AppUser user = ((AppUserDetails) authentication.getPrincipal()).getUser();
    if (user.getStatus() != AppUser.Status.ACTIVE) {
      throw new BadRequestException("This account is not active.");
    }
    user.setLastLoginAt(Instant.now());
    return users.save(user);
  }

  // ---------------------------------------------------------------- oauth sign in

  @SuppressWarnings("null")
  public AppUser findOrCreateOAuthUser(
      AppUser.AuthProvider provider, String providerId, String email, String name,
      String avatarUrl) {

    Optional<AppUser> byProvider = users.findByAuthProviderAndProviderId(provider, providerId);
    if (byProvider.isPresent()) {
      AppUser user = byProvider.get();
      user.setAvatarUrl(avatarUrl != null ? avatarUrl : user.getAvatarUrl());
      user.setEmailVerified(true);
      user.setLastLoginAt(Instant.now());
      return users.save(user);
    }

    String normalised = email.trim().toLowerCase();
    Optional<AppUser> byEmail = users.findByEmailIgnoreCase(normalised);
    if (byEmail.isPresent()) {
      // Link the existing local account to Google once the email matches.
      AppUser user = byEmail.get();
      user.setAuthProvider(provider);
      user.setProviderId(providerId);
      user.setAvatarUrl(avatarUrl);
      user.setEmailVerified(true);
      user.setLastLoginAt(Instant.now());
      return users.save(user);
    }

    AppUser user = new AppUser();
    user.setEmail(normalised);
    user.setFullName(name);
    user.setAvatarUrl(avatarUrl);
    user.setAuthProvider(provider);
    user.setProviderId(providerId);
    user.setEmailVerified(true);
    user.setLastLoginAt(Instant.now());
    user.setRoles(Set.of(requireRole(ROLE_USER)));

    AppUser saved = users.save(user);
    profileService.createDefaultProfile(saved);
    return saved;
  }

  // --------------------------------------------------------------- refresh tokens

  /** Issues an opaque refresh token; only its SHA-256 hash is persisted. */
  public String issueRefreshToken(AppUser user, HttpServletRequest request) {
    String token = HashSupport.randomToken();
    RefreshToken entity = new RefreshToken();
    entity.setUser(user);
    entity.setTokenHash(HashSupport.sha256(token));
    entity.setFamilyId(java.util.UUID.randomUUID());
    entity.setExpiresAt(Instant.now().plus(properties.getJwt().getRefreshTokenTtl()));
    entity.setUserAgent(truncate(request == null ? null : request.getHeader("User-Agent"), 255));
    entity.setIpAddress(request == null ? null : clientIp(request));
    refreshTokens.save(entity);
    return token;
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a brand new pair is returned.
   * A token that has already been revoked invalidates its whole family (replay detection).
   */
  public Rotation rotateRefreshToken(String token, HttpServletRequest request) {
    RefreshToken stored =
        refreshTokens
            .findByTokenHash(HashSupport.sha256(token))
            .orElseThrow(() -> new BadRequestException("Invalid refresh token."));

    if (stored.getRevokedAt() != null) {
      revokeFamily(stored.getFamilyId());
      throw new BadRequestException("Refresh token has already been used.");
    }
    if (!stored.isUsable()) {
      throw new BadRequestException("Refresh token has expired.");
    }

    stored.setRevokedAt(Instant.now());
    refreshTokens.save(stored);

    AppUser user = stored.getUser();
    return new Rotation(user, issueRefreshToken(user, request));
  }

  /** Result of a refresh: the account plus the newly issued opaque refresh token. */
  public record Rotation(AppUser user, String refreshToken) {}

  public void revokeRefreshToken(String token) {
    refreshTokens
        .findByTokenHash(HashSupport.sha256(token))
        .ifPresent(
            stored -> {
              stored.setRevokedAt(Instant.now());
              refreshTokens.save(stored);
            });
  }

  public void revokeAllFor(UUID userId) {
    for (RefreshToken token : refreshTokens.findByUserIdAndRevokedAtIsNull(userId)) {
      token.setRevokedAt(Instant.now());
      refreshTokens.save(token);
    }
  }

  private void revokeFamily(java.util.UUID familyId) {
    refreshTokens.findAllByFamilyId(familyId).forEach(
            token -> {
              token.setRevokedAt(Instant.now());
              refreshTokens.save(token);
            });
  }

  // -------------------------------------------------------------------- helpers

  public AppUser requireById(UUID id) {
    return users.findById(id).orElseThrow(() -> new NotFoundException("User not found."));
  }

  public long accessTokenTtlSeconds() {
    return jwtService.accessTokenTtlSeconds();
  }

  public List<AppUser> findAll() {
    return users.findAll();
  }

  private Role requireRole(String code) {
    return roles
        .findByCode(code)
        .orElseThrow(() -> new IllegalStateException("Missing role " + code + " — run V3__seed_ott.sql"));
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }

  private static String truncate(String value, int max) {
    if (value == null) {
      return null;
    }
    return value.length() <= max ? value : value.substring(0, max);
  }

  private static String clientIp(HttpServletRequest request) {
    String forwarded = request.getHeader("X-Forwarded-For");
    if (forwarded != null && !forwarded.isBlank()) {
      return forwarded.split(",")[0].trim();
    }
    return request.getRemoteAddr();
  }
}
