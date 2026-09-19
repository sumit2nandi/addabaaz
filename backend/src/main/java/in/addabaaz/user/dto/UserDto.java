package in.addabaaz.user.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import in.addabaaz.user.AppUser;

public record UserDto(
    UUID id,
    String email,
    String fullName,
    String phone,
    String avatarUrl,
    String authProvider,
    boolean emailVerified,
    List<String> roles,
    Instant createdAt,
    Instant lastLoginAt) {

  public static UserDto from(AppUser user) {
    return new UserDto(
        user.getId(),
        user.getEmail(),
        user.getFullName(),
        user.getPhone(),
        user.getAvatarUrl(),
        user.getAuthProvider().name(),
        user.isEmailVerified(),
        user.getRoles().stream().map(role -> role.getCode()).sorted().toList(),
        user.getCreatedAt(),
        user.getLastLoginAt());
  }
}
