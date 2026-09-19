package in.addabaaz.user.dto;

public record AuthResponse(
    String accessToken, String refreshToken, String tokenType, long expiresIn, UserDto user) {

  public static AuthResponse of(
      String accessToken, String refreshToken, long expiresInSeconds, UserDto user) {
    return new AuthResponse(accessToken, refreshToken, "Bearer", expiresInSeconds, user);
  }
}
