package in.addabaaz.catalog.dto;

import java.util.List;

import in.addabaaz.catalog.Show;

/** Full show payload including its episode list — used by /watch/{key}. */
public record ShowDto(
    String key,
    String title,
    String subtitle,
    String description,
    String image,
    String genre,
    List<String> genres,
    List<String> tags,
    double averageRating,
    long ratingCount,
    List<EpisodeDto> episodes) {

  public static ShowDto from(Show show, double averageRating, long ratingCount) {
    return new ShowDto(
        show.getKey(),
        show.getTitle(),
        show.getSubtitle(),
        show.getDescription(),
        show.getImageUrl(),
        show.getGenre(),
        show.getGenres().stream().map(in.addabaaz.catalog.Genre::getName).toList(),
        show.getTags().stream().map(in.addabaaz.catalog.Tag::getName).toList(),
        averageRating,
        ratingCount,
        show.getEpisodes().stream().map(EpisodeDto::from).toList());
  }
}
