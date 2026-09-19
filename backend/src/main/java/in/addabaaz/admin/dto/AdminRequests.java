package in.addabaaz.admin.dto;

import java.time.Instant;
import java.util.List;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/** Write payloads used by the /api/admin endpoints. */
public final class AdminRequests {

  private AdminRequests() {}

  public record ShowRequest(
      @NotBlank @Size(max = 60) String key,
      @NotBlank @Size(max = 200) String title,
      @Size(max = 200) String subtitle,
      String description,
      String imageUrl,
      @Size(max = 80) String genre,
      Integer sortOrder,
      Boolean published,
      List<String> genres,
      List<String> tags) {}

  public record EpisodeRequest(
      @Size(max = 40) String externalId,
      Integer episodeNo,
      @NotBlank @Size(max = 500) String title,
      @Size(max = 40) String youtubeId,
      @Size(max = 10) String duration,
      @PositiveOrZero Long views,
      String thumbnailUrl,
      @Size(max = 20) String availability,
      @Size(max = 20) String kind,
      Instant publishDate) {}

  public record PromoRequest(
      @Size(max = 40) String externalId,
      @NotBlank @Size(max = 500) String title,
      @Size(max = 40) String youtubeId,
      @Size(max = 10) String duration,
      @PositiveOrZero Long views,
      String thumbnailUrl,
      @Size(max = 20) String kind,
      Instant publishDate) {}

  public record PosterRequest(
      @Size(max = 20) String kind,
      @NotBlank @Size(max = 80) String folder,
      @NotBlank @Size(max = 200) String fileName,
      @Size(max = 200) String title,
      @Size(max = 40) String badge,
      Integer sortOrder,
      Boolean published) {}

  public record BannerRequest(
      String showKey,
      @Size(max = 200) String title,
      @Size(max = 200) String subtitle,
      String imageUrl,
      @Size(max = 40) String youtubeId,
      @Size(max = 40) String ctaLabel,
      Integer sortOrder,
      Boolean active) {}

  public record TeamRequest(
      @NotBlank @Size(max = 120) String name,
      @Size(max = 120) String role,
      String imageUrl,
      String quote,
      Integer sortOrder,
      Boolean published) {}

  public record ServiceRequest(
      @NotBlank @Size(max = 5) String num,
      @NotBlank @Size(max = 120) String title,
      String description,
      Integer sortOrder,
      Boolean published) {}

  public record UserStatusRequest(String status, Boolean admin, Boolean suspended) {}
}
