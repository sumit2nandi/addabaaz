package in.addabaaz.engagement.dto;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.engagement.Review;

public record ReviewDto(
    UUID id,
    String showKey,
    UUID userId,
    String author,
    String title,
    String body,
    boolean spoiler,
    String status,
    Instant createdAt) {

  public static ReviewDto from(Review review) {
    return new ReviewDto(
        review.getId(),
        review.getShow().getKey(),
        review.getUser().getId(),
        review.getUser().getFullName() != null ? review.getUser().getFullName() : review.getUser().getEmail(),
        review.getTitle(),
        review.getBody(),
        review.isSpoiler(),
        review.getStatus(),
        review.getCreatedAt());
  }
}
