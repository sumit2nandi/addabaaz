package in.addabaaz.engagement;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.common.BadRequestException;
import in.addabaaz.common.NotFoundException;
import in.addabaaz.user.AppUser;

/** Profile management — every account owns at least one profile. */
@Service
@Transactional
public class ProfileService {

  private final UserProfileRepository profiles;

  public ProfileService(UserProfileRepository profiles) {
    this.profiles = profiles;
  }

  public UserProfile createDefaultProfile(AppUser user) {
    UserProfile profile = new UserProfile();
    profile.setUser(user);
    profile.setName(defaultName(user));
    profile.setDefault(true);
    return profiles.save(profile);
  }

  public UserProfile create(AppUser user, String name, boolean kids, String pin, String avatarUrl) {
    if (name == null || name.isBlank()) {
      throw new BadRequestException("Profile name is required.");
    }
    if (profiles.existsByUserIdAndNameIgnoreCase(user.getId(), name.trim())) {
      throw new in.addabaaz.common.ConflictException("A profile with that name already exists.");
    }
    UserProfile profile = new UserProfile();
    profile.setUser(user);
    profile.setName(name.trim());
    profile.setKids(kids);
    profile.setPin(pin);
    profile.setAvatarUrl(avatarUrl);
    return profiles.save(profile);
  }

  public List<UserProfile> listFor(UUID userId) {
    return profiles.findAllByUserIdOrderByIsDefaultDescNameAsc(userId);
  }

  /** Resolves the profile to act as: an explicit id, otherwise the account's default. */
  @Transactional(readOnly = true)
  public UserProfile resolve(AppUser user, UUID profileId) {
    if (profileId != null) {
      return profiles
          .findByIdAndUserId(profileId, user.getId())
          .orElseThrow(() -> new NotFoundException("Profile not found."));
    }
    return profiles
        .findByUserIdAndIsDefaultTrue(user.getId())
        .orElseGet(() -> listFor(user.getId()).stream().findFirst().orElse(null));
  }

  @Transactional(readOnly = true)
  public UserProfile require(AppUser user, UUID profileId) {
    UserProfile profile = resolve(user, profileId);
    if (profile == null) {
      throw new NotFoundException("No profile selected.");
    }
    return profile;
  }

  public void delete(AppUser user, UUID profileId) {
    UserProfile profile = require(user, profileId);
    if (profile.isDefault()) {
      throw new BadRequestException("The default profile cannot be deleted.");
    }
    profiles.delete(profile);
  }

  private static String defaultName(AppUser user) {
    if (user.getFullName() != null && !user.getFullName().isBlank()) {
      return user.getFullName().trim();
    }
    int at = user.getEmail().indexOf('@');
    return at > 0 ? user.getEmail().substring(0, at) : "Main";
  }
}
