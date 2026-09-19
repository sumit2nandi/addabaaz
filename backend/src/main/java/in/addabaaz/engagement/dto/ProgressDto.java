package in.addabaaz.engagement.dto;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.engagement.PlaybackProgress;

/** One "continue watching" row. */
public record ProgressDto(
    UUID id,
    String target,      // 'episode' | 'promo'
    String episodeId,
    String promoId,
    String showKey,
    String showTitle,
    String title,
    String thumbnail,
    String youtubeId,
    int positionSeconds,
    int durationSeconds,
    boolean completed,
    Instant updatedAt) {

  public static ProgressDto from(PlaybackProgress progress) {
    if (progress.getEpisode() != null) {
      var episode = progress.getEpisode();
      return new ProgressDto(
          progress.getId(),
          "episode",
          episode.getExternalId(),
          null,
          episode.getShow().getKey(),
          episode.getShow().getTitle(),
          episode.getTitle(),
          episode.getThumbnailUrl(),
          episode.getYoutubeId(),
          progress.getPositionSeconds(),
          progress.getDurationSeconds(),
          progress.isCompleted(),
          progress.getUpdatedAt());
    }

    var promo = progress.getPromo();
    return new ProgressDto(
        progress.getId(),
        "promo",
        null,
        promo.getExternalId(),
        null,
        null,
        promo.getTitle(),
        promo.getThumbnailUrl(),
        promo.getYoutubeId(),
        progress.getPositionSeconds(),
        progress.getDurationSeconds(),
        progress.isCompleted(),
        progress.getUpdatedAt());
  }
}
