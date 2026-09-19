package in.addabaaz.engagement.dto;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.engagement.UserProfile;

public record ProfileDto(
    UUID id, String name, String avatarUrl, boolean kids, boolean isDefault, Instant createdAt) {

  public static ProfileDto from(UserProfile profile) {
    return new ProfileDto(
        profile.getId(),
        profile.getName(),
        profile.getAvatarUrl(),
        profile.isKids(),
        profile.isDefault(),
        profile.getCreatedAt());
  }
}
