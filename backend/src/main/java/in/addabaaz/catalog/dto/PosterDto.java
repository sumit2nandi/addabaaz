package in.addabaaz.catalog.dto;

import in.addabaaz.catalog.Poster;

public record PosterDto(String kind, String folder, String fileName, String title, String badge) {

  public static PosterDto from(Poster poster) {
    return new PosterDto(
        poster.getKind(), poster.getFolder(), poster.getFileName(), poster.getTitle(),
        poster.getBadge());
  }
}
