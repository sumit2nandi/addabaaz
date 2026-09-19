package in.addabaaz.catalog.dto;

import java.util.List;

/** Everything the landing page needs, in one request. */
public record HomeDto(
    List<BannerDto> banners,
    List<ShowSummaryDto> shows,
    List<PromoDto> promos,
    List<PosterDto> upcoming,
    List<PosterDto> behindTheScenes,
    PosterDto featuredUpcoming) {}
