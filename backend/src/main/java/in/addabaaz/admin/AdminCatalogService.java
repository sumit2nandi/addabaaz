package in.addabaaz.admin;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.admin.dto.AdminRequests;
import in.addabaaz.catalog.Banner;
import in.addabaaz.catalog.BannerRepository;
import in.addabaaz.catalog.Episode;
import in.addabaaz.catalog.EpisodeRepository;
import in.addabaaz.catalog.Genre;
import in.addabaaz.catalog.GenreRepository;
import in.addabaaz.catalog.Poster;
import in.addabaaz.catalog.PosterRepository;
import in.addabaaz.catalog.PromoVideo;
import in.addabaaz.catalog.PromoVideoRepository;
import in.addabaaz.catalog.ServiceItem;
import in.addabaaz.catalog.ServiceRepository;
import in.addabaaz.catalog.Show;
import in.addabaaz.catalog.ShowRepository;
import in.addabaaz.catalog.SiteSetting;
import in.addabaaz.catalog.SiteSettingRepository;
import in.addabaaz.catalog.Tag;
import in.addabaaz.catalog.TagRepository;
import in.addabaaz.catalog.TeamMember;
import in.addabaaz.catalog.TeamMemberRepository;
import in.addabaaz.common.ConflictException;
import in.addabaaz.common.NotFoundException;

/** Write side of the catalogue — accessible to ROLE_ADMIN only. */
@Service
@Transactional
public class AdminCatalogService {

  private final ShowRepository shows;
  private final EpisodeRepository episodes;
  private final PromoVideoRepository promos;
  private final PosterRepository posters;
  private final BannerRepository banners;
  private final TeamMemberRepository team;
  private final ServiceRepository services;
  private final SiteSettingRepository settings;
  private final GenreRepository genres;
  private final TagRepository tags;

  @SuppressWarnings("java:S107")
  public AdminCatalogService(
      ShowRepository shows,
      EpisodeRepository episodes,
      PromoVideoRepository promos,
      PosterRepository posters,
      BannerRepository banners,
      TeamMemberRepository team,
      ServiceRepository services,
      SiteSettingRepository settings,
      GenreRepository genres,
      TagRepository tags) {
    this.shows = shows;
    this.episodes = episodes;
    this.promos = promos;
    this.posters = posters;
    this.banners = banners;
    this.team = team;
    this.services = services;
    this.settings = settings;
    this.genres = genres;
    this.tags = tags;
  }

  // -------------------------------------------------------------------- shows

  public Show createShow(AdminRequests.ShowRequest request) {
    if (shows.findByKey(request.key()).isPresent()) {
      throw new ConflictException("A show with key '" + request.key() + "' already exists.");
    }
    Show show = new Show();
    applyShow(show, request);
    return shows.save(show);
  }

  public Show updateShow(String key, AdminRequests.ShowRequest request) {
    Show show = shows.findByKey(key).orElseThrow(() -> new NotFoundException("No show '" + key + "'."));
    applyShow(show, request);
    return shows.save(show);
  }

  public void deleteShow(String key) {
    shows.delete(shows.findByKey(key).orElseThrow(() -> new NotFoundException("No show '" + key + "'.")));
  }

  private void applyShow(Show show, AdminRequests.ShowRequest request) {
    show.setKey(request.key());
    show.setTitle(request.title());
    show.setSubtitle(request.subtitle());
    show.setDescription(request.description());
    show.setImageUrl(request.imageUrl());
    show.setGenre(request.genre());
    show.setSortOrder(request.sortOrder() == null ? show.getSortOrder() : request.sortOrder());
    show.setPublished(request.published() == null ? show.isPublished() : request.published());

    if (request.genres() != null) {
      List<Genre> linked = new ArrayList<>();
      for (String name : request.genres()) {
        linked.add(genres.findByNameIgnoreCase(name).orElseGet(() -> genres.save(newGenre(name))));
      }
      show.setGenres(linked);
    }
    if (request.tags() != null) {
      List<Tag> linked = new ArrayList<>();
      for (String name : request.tags()) {
        linked.add(tags.findByNameIgnoreCase(name).orElseGet(() -> tags.save(newTag(name))));
      }
      show.setTags(linked);
    }
  }

  private Genre newGenre(String name) {
    Genre genre = new Genre();
    genre.setName(name);
    genre.setSlug(slug(name));
    return genre;
  }

  private Tag newTag(String name) {
    Tag tag = new Tag();
    tag.setName(name);
    tag.setSlug(slug(name));
    return tag;
  }

  private static String slug(String value) {
    return value.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
  }

  // ----------------------------------------------------------------- episodes

  public Episode addEpisode(String showKey, AdminRequests.EpisodeRequest request) {
    Show show = shows.findByKey(showKey).orElseThrow(() -> new NotFoundException("No show '" + showKey + "'."));
    Episode episode = new Episode();
    episode.setShow(show);
    applyEpisode(episode, request, show.getEpisodes().size());
    show.getEpisodes().add(episode);
    return episodes.save(episode);
  }

  public Episode updateEpisode(String showKey, String externalId, AdminRequests.EpisodeRequest request) {
    Episode episode =
        episodes
            .findByShowKeyAndExternalId(showKey, externalId)
            .orElseThrow(() -> new NotFoundException("No episode '" + externalId + "'."));
    applyEpisode(episode, request, episode.getPosition());
    return episodes.save(episode);
  }

  public void deleteEpisode(String showKey, String externalId) {
    episodes.delete(
        episodes
            .findByShowKeyAndExternalId(showKey, externalId)
            .orElseThrow(() -> new NotFoundException("No episode '" + externalId + "'.")));
  }

  /** Replaces the episode list of a show in one transaction (used for bulk imports). */
  public int replaceEpisodes(String showKey, List<AdminRequests.EpisodeRequest> requests) {
    Show show = shows.findByKey(showKey).orElseThrow(() -> new NotFoundException("No show '" + showKey + "'."));
    episodes.deleteAll(new ArrayList<>(show.getEpisodes()));
    show.getEpisodes().clear();

    int index = 0;
    for (AdminRequests.EpisodeRequest request : requests) {
      Episode episode = new Episode();
      episode.setShow(show);
      applyEpisode(episode, request, index++);
      show.getEpisodes().add(episode);
      episodes.save(episode);
    }
    return shows.save(show).getEpisodes().size();
  }

  private void applyEpisode(Episode episode, AdminRequests.EpisodeRequest request, int position) {
    episode.setExternalId(
        request.externalId() == null ? "e" + System.currentTimeMillis() : request.externalId());
    episode.setTitle(request.title());
    episode.setYoutubeId(request.youtubeId());
    episode.setDuration(request.duration());
    episode.setViews(request.views() == null ? 0L : request.views());
    episode.setThumbnailUrl(request.thumbnailUrl());
    episode.setAvailability(
        request.availability() == null ? "available" : request.availability());
    episode.setEpisodeNo(request.episodeNo());
    episode.setKind(request.kind() == null ? Episode.Kind.EPISODE.name() : request.kind());
    episode.setPublishDate(request.publishDate() == null ? Instant.now() : request.publishDate());
    episode.setPosition(position);
  }

  // ------------------------------------------------------------------- promos

  public PromoVideo createPromo(AdminRequests.PromoRequest request) {
    PromoVideo promo = new PromoVideo();
    applyPromo(promo, request);
    promo.setPosition((int) (promos.count() + 1));
    return promos.save(promo);
  }

  public PromoVideo updatePromo(String externalId, AdminRequests.PromoRequest request) {
    PromoVideo promo =
        promos
            .findByExternalId(externalId)
            .orElseThrow(() -> new NotFoundException("No promo '" + externalId + "'."));
    applyPromo(promo, request);
    return promos.save(promo);
  }

  public void deletePromo(String externalId) {
    promos.delete(
        promos
            .findByExternalId(externalId)
            .orElseThrow(() -> new NotFoundException("No promo '" + externalId + "'.")));
  }

  private void applyPromo(PromoVideo promo, AdminRequests.PromoRequest request) {
    promo.setExternalId(
        request.externalId() == null ? "p" + System.currentTimeMillis() : request.externalId());
    promo.setTitle(request.title());
    promo.setYoutubeId(request.youtubeId());
    promo.setDuration(request.duration());
    promo.setViews(request.views() == null ? 0L : request.views());
    promo.setThumbnailUrl(request.thumbnailUrl());
    promo.setKind(request.kind() == null ? "PROMO" : request.kind());
    promo.setPublishDate(request.publishDate() == null ? Instant.now() : request.publishDate());
  }

  // ------------------------------------------------------------------ posters

  public Poster createPoster(AdminRequests.PosterRequest request) {
    Poster poster = new Poster();
    applyPoster(poster, request);
    poster.setSortOrder(request.sortOrder() == null ? (int) posters.count() : request.sortOrder());
    return posters.save(poster);
  }

  public Poster updatePoster(UUID id, AdminRequests.PosterRequest request) {
    Poster poster = posters.findById(id).orElseThrow(() -> new NotFoundException("No such poster."));
    applyPoster(poster, request);
    return posters.save(poster);
  }

  public void deletePoster(UUID id) {
    posters.delete(posters.findById(id).orElseThrow(() -> new NotFoundException("No such poster.")));
  }

  private void applyPoster(Poster poster, AdminRequests.PosterRequest request) {
    poster.setKind(request.kind() == null ? Poster.Kind.UPCOMING.name() : request.kind().toUpperCase());
    poster.setFolder(request.folder());
    poster.setFileName(request.fileName());
    poster.setTitle(request.title());
    poster.setBadge(request.badge());
    if (request.sortOrder() != null) {
      poster.setSortOrder(request.sortOrder());
    }
    poster.setPublished(request.published() == null ? true : request.published());
  }

  // ------------------------------------------------------------------ banners

  public Banner createBanner(AdminRequests.BannerRequest request) {
    Banner banner = new Banner();
    applyBanner(banner, request);
    return banners.save(banner);
  }

  public Banner updateBanner(UUID id, AdminRequests.BannerRequest request) {
    Banner banner = banners.findById(id).orElseThrow(() -> new NotFoundException("No such banner."));
    applyBanner(banner, request);
    return banners.save(banner);
  }

  public void deleteBanner(UUID id) {
    banners.delete(banners.findById(id).orElseThrow(() -> new NotFoundException("No such banner.")));
  }

  private void applyBanner(Banner banner, AdminRequests.BannerRequest request) {
    if (request.showKey() != null) {
      banner.setShow(
          shows.findByKey(request.showKey()).orElseThrow(() -> new NotFoundException("No such show.")));
    }
    banner.setTitle(request.title());
    banner.setSubtitle(request.subtitle());
    banner.setImageUrl(request.imageUrl());
    banner.setYoutubeId(request.youtubeId());
    banner.setCtaLabel(request.ctaLabel() == null ? "Watch now" : request.ctaLabel());
    if (request.sortOrder() != null) {
      banner.setSortOrder(request.sortOrder());
    }
    banner.setActive(request.active() == null ? true : request.active());
  }

  // ------------------------------------------------------------ team/services

  public TeamMember createTeamMember(AdminRequests.TeamRequest request) {
    TeamMember member = new TeamMember();
    applyTeam(member, request);
    return team.save(member);
  }

  public TeamMember updateTeamMember(UUID id, AdminRequests.TeamRequest request) {
    TeamMember member = team.findById(id).orElseThrow(() -> new NotFoundException("No such member."));
    applyTeam(member, request);
    return team.save(member);
  }

  public void deleteTeamMember(UUID id) {
    team.delete(team.findById(id).orElseThrow(() -> new NotFoundException("No such member.")));
  }

  private void applyTeam(TeamMember member, AdminRequests.TeamRequest request) {
    member.setName(request.name());
    member.setRole(request.role());
    member.setImageUrl(request.imageUrl());
    member.setQuote(request.quote());
    if (request.sortOrder() != null) {
      member.setSortOrder(request.sortOrder());
    }
    member.setPublished(request.published() == null ? true : request.published());
  }

  public ServiceItem createService(AdminRequests.ServiceRequest request) {
    ServiceItem service = new ServiceItem();
    applyService(service, request);
    return services.save(service);
  }

  public ServiceItem updateService(UUID id, AdminRequests.ServiceRequest request) {
    ServiceItem service = services.findById(id).orElseThrow(() -> new NotFoundException("No such service."));
    applyService(service, request);
    return services.save(service);
  }

  public void deleteService(UUID id) {
    services.delete(services.findById(id).orElseThrow(() -> new NotFoundException("No such service.")));
  }

  private void applyService(ServiceItem service, AdminRequests.ServiceRequest request) {
    service.setNum(request.num());
    service.setTitle(request.title());
    service.setDescription(request.description());
    if (request.sortOrder() != null) {
      service.setSortOrder(request.sortOrder());
    }
    service.setPublished(request.published() == null ? true : request.published());
  }

  // ----------------------------------------------------------------- settings

  public SiteSetting putSetting(String key, String json) {
    SiteSetting setting = settings.findByKey(key).orElseGet(SiteSetting::new);
    setting.setKey(key);
    setting.setValue(json);
    return settings.save(setting);
  }

  public void deleteSetting(String key) {
    settings.delete(settings.findByKey(key).orElseThrow(() -> new NotFoundException("No setting '" + key + "'.")));
  }
}
