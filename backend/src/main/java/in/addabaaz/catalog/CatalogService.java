package in.addabaaz.catalog;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import in.addabaaz.catalog.dto.BannerDto;
import in.addabaaz.catalog.dto.EpisodeDto;
import in.addabaaz.catalog.dto.EpisodeResolutionDto;
import in.addabaaz.catalog.dto.HomeDto;
import in.addabaaz.catalog.dto.PosterDto;
import in.addabaaz.catalog.dto.PromoDto;
import in.addabaaz.catalog.dto.ServiceDto;
import in.addabaaz.catalog.dto.ShowDto;
import in.addabaaz.catalog.dto.ShowSummaryDto;
import in.addabaaz.catalog.dto.TeamMemberDto;
import in.addabaaz.common.NotFoundException;
import in.addabaaz.engagement.RatingRepository;

/** Read side of the catalogue. */
@Service
@Transactional(readOnly = true)
public class CatalogService {

  private static final int HOME_PROMO_LIMIT = 20;
  private static final int HOME_POSTER_LIMIT = 10;

  private final ShowRepository shows;
  private final EpisodeRepository episodes;
  private final PromoVideoRepository promos;
  private final PosterRepository posters;
  private final BannerRepository banners;
  private final TeamMemberRepository team;
  private final ServiceRepository services;
  private final SiteSettingRepository settings;
  private final RatingRepository ratings;
  private final ObjectMapper objectMapper;

  public CatalogService(
      ShowRepository shows,
      EpisodeRepository episodes,
      PromoVideoRepository promos,
      PosterRepository posters,
      BannerRepository banners,
      TeamMemberRepository team,
      ServiceRepository services,
      SiteSettingRepository settings,
      RatingRepository ratings,
      ObjectMapper objectMapper) {
    this.shows = shows;
    this.episodes = episodes;
    this.promos = promos;
    this.posters = posters;
    this.banners = banners;
    this.team = team;
    this.services = services;
    this.settings = settings;
    this.ratings = ratings;
    this.objectMapper = objectMapper;
  }

  // ---------------------------------------------------------------------- home

  public HomeDto home() {
    List<PromoDto> promoDtos =
        promos.findAllByOrderByPositionDesc().stream().limit(HOME_PROMO_LIMIT).map(PromoDto::from).toList();

    PosterDto featured = null;
    java.util.Optional<SiteSetting> featuredSetting = settings.findByKey("home.featuredUpcoming");
    if (featuredSetting.isPresent()) {
      try {
        JsonNode node = objectMapper.readTree(featuredSetting.get().getValue());
        featured =
            new PosterDto(
                "UPCOMING",
                node.path("folder").asText("UpcomingReleases/"),
                node.path("fileName").asText(""),
                null,
                node.path("badge").asText(null));
      } catch (JsonProcessingException e) {
        featured = null;
      }
    }

    return new HomeDto(
        banners.findAllByActiveTrueOrderBySortOrderAsc().stream().map(BannerDto::from).toList(),
        showsWithRatings(),
        promoDtos,
        posters.findAllByKindAndPublishedTrueOrderBySortOrderAsc(Poster.Kind.UPCOMING.name())
            .stream().limit(HOME_POSTER_LIMIT).map(PosterDto::from).toList(),
        posters.findAllByKindAndPublishedTrueOrderBySortOrderAsc(Poster.Kind.BTS.name())
            .stream().limit(HOME_POSTER_LIMIT).map(PosterDto::from).toList(),
        featured);
  }

  // --------------------------------------------------------------------- shows

  public List<ShowSummaryDto> shows() {
    return showsWithRatings();
  }

  /** Admin listing: includes unpublished shows. */
  public List<ShowSummaryDto> showsAdmin() {
    return shows.findAll().stream()
        .map(
            show ->
                ShowSummaryDto.from(
                    show, ratings.averageScore(show.getId()), ratings.countByShow(show.getId())))
        .toList();
  }

  public ShowDto show(String key) {
    Show show = shows.findByKey(key).orElseThrow(() -> new NotFoundException("No show '" + key + "'."));
    return ShowDto.from(show, ratings.averageScore(show.getId()), ratings.countByShow(show.getId()));
  }

  public List<EpisodeDto> episodesOf(String showKey) {
    requireShow(showKey);
    return episodes.findAllByShowKeyOrderByEpisodeNoAscPositionAsc(showKey).stream()
        .map(EpisodeDto::from)
        .toList();
  }

  public EpisodeResolutionDto resolveEpisode(String showKey, String episodeId) {
    Show show = requireShow(showKey);
    Episode episode =
        episodes
            .findByShowKeyAndExternalId(showKey, episodeId)
            .or(() -> episodes.findById(java.util.UUID.fromString(episodeId)).filter(e -> e.getShow().getKey().equals(showKey)))
            .orElseThrow(() -> new NotFoundException("No episode '" + episodeId + "' in '" + showKey + "'."));

    List<EpisodeDto> all =
        episodes.findAllByShowKeyOrderByEpisodeNoAscPositionAsc(showKey).stream()
            .map(EpisodeDto::from)
            .toList();
    return new EpisodeResolutionDto(
        ShowDto.from(show, ratings.averageScore(show.getId()), ratings.countByShow(show.getId())),
        EpisodeDto.from(episode),
        all);
  }

  // -------------------------------------------------------------------- promos

  public List<PromoDto> promos() {
    return promos.findAllByOrderByPositionDesc().stream().map(PromoDto::from).toList();
  }

  public PromoDto promo(String externalId) {
    return promos
        .findByExternalId(externalId)
        .map(PromoDto::from)
        .orElseThrow(() -> new NotFoundException("No promo '" + externalId + "'."));
  }

  // ------------------------------------------------------------------- posters

  public List<PosterDto> posters(String kind) {
    String normalised = kind == null ? "UPCOMING" : kind.toUpperCase();
    return posters.findAllByKindAndPublishedTrueOrderBySortOrderAsc(normalised).stream()
        .map(PosterDto::from)
        .toList();
  }

  // ---------------------------------------------------------------- misc pages

  public List<BannerDto> banners() {
    return banners.findAllByActiveTrueOrderBySortOrderAsc().stream().map(BannerDto::from).toList();
  }

  public List<TeamMemberDto> team() {
    return team.findAllByPublishedTrueOrderBySortOrderAsc().stream().map(TeamMemberDto::from).toList();
  }

  public List<ServiceDto> services() {
    return services.findAllByPublishedTrueOrderBySortOrderAsc().stream().map(ServiceDto::from).toList();
  }

  /** Every site_setting row, parsed back into JSON. */
  public Map<String, JsonNode> settings() {
    return settings.findAllByOrderByKeyAsc().stream()
        .collect(
            Collectors.toMap(
                SiteSetting::getKey,
                setting -> {
                  try {
                    return objectMapper.readTree(setting.getValue());
                  } catch (JsonProcessingException e) {
                    return objectMapper.getNodeFactory().textNode(setting.getValue());
                  }
                },
                (left, right) -> right,
                java.util.LinkedHashMap::new));
  }

  public JsonNode setting(String key) {
    return settings
        .findByKey(key)
        .map(
            setting -> {
              try {
                return objectMapper.readTree(setting.getValue());
              } catch (JsonProcessingException e) {
                return objectMapper.getNodeFactory().textNode(setting.getValue());
              }
            })
        .orElseThrow(() -> new NotFoundException("No setting '" + key + "'."));
  }

  // ------------------------------------------------------------------- helpers

  Show requireShow(String key) {
    return shows.findByKey(key).orElseThrow(() -> new NotFoundException("No show '" + key + "'."));
  }

  private List<ShowSummaryDto> showsWithRatings() {
    return shows.findAllByPublishedTrueOrderBySortOrderAsc().stream()
        .map(show -> ShowSummaryDto.from(
            show, ratings.averageScore(show.getId()), ratings.countByShow(show.getId())))
        .toList();
  }
}
