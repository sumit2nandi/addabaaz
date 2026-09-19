package in.addabaaz.engagement.dto;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.engagement.WatchHistory;

public record HistoryDto(
    UUID id,
    String target,
    String episodeId,
    String promoId,
    String showKey,
    String title,
    String thumbnail,
    int progressSeconds,
    Instant watchedAt) {

  public static HistoryDto from(WatchHistory history) {
    if (history.getEpisode() != null) {
      var episode = history.getEpisode();
      return new HistoryDto(
          history.getId(),
          "episode",
          episode.getExternalId(),
          null,
          episode.getShow().getKey(),
          episode.getTitle(),
          episode.getThumbnailUrl(),
          history.getProgressSeconds(),
          history.getWatchedAt());
    }
    var promo = history.getPromo();
    return new HistoryDto(
        history.getId(),
        "promo",
        null,
        promo.getExternalId(),
        null,
        promo.getTitle(),
        promo.getThumbnailUrl(),
        history.getProgressSeconds(),
        history.getWatchedAt());
  }
}
