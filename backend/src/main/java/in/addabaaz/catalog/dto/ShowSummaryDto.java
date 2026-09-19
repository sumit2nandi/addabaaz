package in.addabaaz.catalog.dto;

import java.util.List;

import in.addabaaz.catalog.Show;

public record ShowSummaryDto(
    String key,
    String title,
    String subtitle,
    String description,
    String image,
    String genre,
    int episodeCount,
    List<String> genres,
    List<String> tags,
    double averageRating,
    long ratingCount) {

  public static ShowSummaryDto from(Show show, double averageRating, long ratingCount) {
    return new ShowSummaryDto(
        show.getKey(),
        show.getTitle(),
        show.getSubtitle(),
        show.getDescription(),
        show.getImageUrl(),
        show.getGenre(),
        show.getEpisodes().size(),
        show.getGenres().stream().map(in.addabaaz.catalog.Genre::getName).toList(),
        show.getTags().stream().map(in.addabaaz.catalog.Tag::getName).toList(),
        averageRating,
        ratingCount);
  }
}
