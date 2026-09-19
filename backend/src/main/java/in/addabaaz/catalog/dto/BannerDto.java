package in.addabaaz.catalog.dto;

import in.addabaaz.catalog.Banner;

public record BannerDto(
    String showKey,
    String title,
    String subtitle,
    String image,
    String youtubeId,
    String ctaLabel) {

  public static BannerDto from(Banner banner) {
    return new BannerDto(
        banner.getShow() != null ? banner.getShow().getKey() : null,
        banner.getTitle(),
        banner.getSubtitle(),
        banner.getImageUrl(),
        banner.getYoutubeId(),
        banner.getCtaLabel());
  }
}
