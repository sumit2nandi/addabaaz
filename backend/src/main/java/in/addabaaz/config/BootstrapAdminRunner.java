package in.addabaaz.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.engagement.ProfileService;
import in.addabaaz.user.AppUser;
import in.addabaaz.user.Role;
import in.addabaaz.user.RoleRepository;
import in.addabaaz.user.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Creates the first administrator once the schema is in place, so the API is usable straight after
 * `mvn spring-boot:run` without seeding password hashes from SQL.
 */
@Component
public class BootstrapAdminRunner implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(BootstrapAdminRunner.class);
  private static final String ROLE_ADMIN = "ROLE_ADMIN";
  private static final String ROLE_USER = "ROLE_USER";

  private final UserRepository users;
  private final RoleRepository roles;
  private final PasswordEncoder passwordEncoder;
  private final ProfileService profileService;
  private final AddabaazProperties properties;

  public BootstrapAdminRunner(
      UserRepository users,
      RoleRepository roles,
      PasswordEncoder passwordEncoder,
      ProfileService profileService,
      AddabaazProperties properties) {
    this.users = users;
    this.roles = roles;
    this.passwordEncoder = passwordEncoder;
    this.profileService = profileService;
    this.properties = properties;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    AddabaazProperties.Bootstrap.Admin admin = properties.getBootstrap().getAdmin();
    if (!admin.isEnabled() || users.existsByEmailIgnoreCase(admin.getEmail())) {
      return;
    }

    Role adminRole = roles.findByCode(ROLE_ADMIN).orElse(null);
    Role userRole = roles.findByCode(ROLE_USER).orElse(null);
    if (adminRole == null) {
      log.warn("Skipping admin bootstrap: no ROLE_ADMIN row — run db/postgresql/V3__seed_ott.sql");
      return;
    }

    AppUser user = new AppUser();
    user.setEmail(admin.getEmail().trim().toLowerCase());
    user.setFullName(admin.getFullName());
    user.setPasswordHash(passwordEncoder.encode(admin.getPassword()));
    user.setAuthProvider(AppUser.AuthProvider.LOCAL);
    user.setEmailVerified(true);
    user.getRoles().add(adminRole);
    if (userRole != null) {
      user.getRoles().add(userRole);
    }

    AppUser saved = users.save(user);
    profileService.createDefaultProfile(saved);

    log.info(
        "Created bootstrap admin {} (change the password in the app!)",
        saved.getEmail());
  }
}
