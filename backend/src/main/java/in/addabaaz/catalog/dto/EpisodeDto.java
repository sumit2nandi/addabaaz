package in.addabaaz.catalog.dto;

import java.time.Instant;

import in.addabaaz.catalog.Episode;

public record EpisodeDto(
    String id,
    int position,
    String title,
    String youtubeId,
    String duration,
    long views,
    String thumbnail,
    String availability,
    Integer episodeNo,
    String kind,
    Instant publishDate) {

  public static EpisodeDto from(Episode episode) {
    return new EpisodeDto(
        episode.getExternalId() != null ? episode.getExternalId() : episode.getId().toString(),
        episode.getPosition(),
        episode.getTitle(),
        episode.getYoutubeId(),
        episode.getDuration(),
        episode.getViews(),
        episode.getThumbnailUrl(),
        episode.getAvailability(),
        episode.getEpisodeNo(),
        episode.getKind(),
        episode.getPublishDate());
  }
}
