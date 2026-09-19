package in.addabaaz.catalog.dto;

import java.time.Instant;

import in.addabaaz.catalog.PromoVideo;

public record PromoDto(
    String id,
    int position,
    String title,
    String youtubeId,
    String duration,
    long views,
    String thumbnail,
    String availability,
    String kind,
    Instant publishDate) {

  public static PromoDto from(PromoVideo promo) {
    return new PromoDto(
        promo.getExternalId() != null ? promo.getExternalId() : promo.getId().toString(),
        promo.getPosition(),
        promo.getTitle(),
        promo.getYoutubeId(),
        promo.getDuration(),
        promo.getViews(),
        promo.getThumbnailUrl(),
        promo.getAvailability(),
        promo.getKind(),
        promo.getPublishDate());
  }
}
