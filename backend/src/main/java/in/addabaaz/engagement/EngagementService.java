package in.addabaaz.engagement;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.catalog.Episode;
import in.addabaaz.catalog.PromoVideo;
import in.addabaaz.catalog.PromoVideoRepository;
import in.addabaaz.catalog.Show;
import in.addabaaz.catalog.ShowRepository;
import in.addabaaz.common.BadRequestException;
import in.addabaaz.common.NotFoundException;
import in.addabaaz.engagement.dto.HistoryDto;
import in.addabaaz.engagement.dto.ProgressDto;
import in.addabaaz.engagement.dto.ProgressRequest;
import in.addabaaz.user.AppUser;

/** Watchlist, continue-watching and history. */
@Service
@Transactional
public class EngagementService {

  private final UserProfileRepository profiles;
  private final WatchlistRepository watchlist;
  private final PlaybackProgressRepository progress;
  private final WatchHistoryRepository history;
  private final ShowRepository shows;
  private final PromoVideoRepository promos;
  private final ProfileService profileService;

  public EngagementService(
      UserProfileRepository profiles,
      WatchlistRepository watchlist,
      PlaybackProgressRepository progress,
      WatchHistoryRepository history,
      ShowRepository shows,
      PromoVideoRepository promos,
      ProfileService profileService) {
    this.profiles = profiles;
    this.watchlist = watchlist;
    this.progress = progress;
    this.history = history;
    this.shows = shows;
    this.promos = promos;
    this.profileService = profileService;
  }

  // ------------------------------------------------------------------ watchlist

  public List<Object> watchlist(AppUser user, UUID profileId) {
    UserProfile profile = profileService.require(user, profileId);
    return watchlist.findByProfileWithShow(profile.getId()).stream()
        .map(entry -> (Object) summarise(entry.getShow()))
        .toList();
  }

  public Object addToWatchlist(AppUser user, String showKey, UUID profileId) {
    Show show = shows.findByKey(showKey).orElseThrow(() -> new NotFoundException("No show '" + showKey + "'."));
    UserProfile profile = profileService.require(user, profileId);
    if (watchlist.findByProfileIdAndShowId(profile.getId(), show.getId()).isEmpty()) {
      Watchlist entry = new Watchlist();
      entry.setUser(user);
      entry.setProfile(profile);
      entry.setShow(show);
      watchlist.save(entry);
    }
    return summarise(show);
  }

  public void removeFromWatchlist(AppUser user, String showKey, UUID profileId) {
    Show show = shows.findByKey(showKey).orElseThrow(() -> new NotFoundException("No show '" + showKey + "'."));
    UserProfile profile = profileService.require(user, profileId);
    watchlist.deleteByProfileIdAndShowId(profile.getId(), show.getId());
  }

  // ------------------------------------------------------------------ progress

  public List<ProgressDto> continueWatching(AppUser user, UUID profileId) {
    UserProfile profile = profileService.require(user, profileId);
    return progress.findContinueWatching(profile.getId()).stream().map(ProgressDto::from).toList();
  }

  public ProgressDto saveProgress(AppUser user, ProgressRequest request) {
    UserProfile profile = profileService.require(user, request.profileId());

    if (request.episodeId() != null) {
      if (request.showKey() == null) {
        throw new BadRequestException("showKey is required with episodeId.");
      }
      Show show = shows.findByKey(request.showKey()).orElseThrow(() -> new NotFoundException("No show."));
      Episode episode =
          show.getEpisodes().stream()
              .filter(candidate -> request.episodeId().equals(candidate.getExternalId()))
              .findFirst()
              .orElseThrow(() -> new NotFoundException("No episode '" + request.episodeId() + "'."));

      PlaybackProgress record =
          progress
              .findByProfileIdAndEpisodeId(profile.getId(), episode.getId())
              .orElseGet(
                  () -> {
                    PlaybackProgress created = new PlaybackProgress();
                    created.setUser(user);
                    created.setProfile(profile);
                    created.setEpisode(episode);
                    return created;
                  });
      record.setPositionSeconds(request.positionSeconds());
      record.setDurationSeconds(request.durationSeconds());
      record.setCompleted(Boolean.TRUE.equals(request.completed()) || isComplete(request));
      record.setUpdatedAt(Instant.now());
      return ProgressDto.from(progress.save(record));
    }

    if (request.promoId() != null) {
      PromoVideo promo =
          promos
              .findByExternalId(request.promoId())
              .orElseThrow(() -> new NotFoundException("No promo '" + request.promoId() + "'."));

      PlaybackProgress record =
          progress
              .findByProfileIdAndPromoId(profile.getId(), promo.getId())
              .orElseGet(
                  () -> {
                    PlaybackProgress created = new PlaybackProgress();
                    created.setUser(user);
                    created.setProfile(profile);
                    created.setPromo(promo);
                    return created;
                  });
      record.setPositionSeconds(request.positionSeconds());
      record.setDurationSeconds(request.durationSeconds());
      record.setCompleted(Boolean.TRUE.equals(request.completed()) || isComplete(request));
      record.setUpdatedAt(Instant.now());
      return ProgressDto.from(progress.save(record));
    }

    throw new BadRequestException("Provide episodeId (with showKey) or promoId.");
  }

  public void deleteProgress(AppUser user, UUID progressId, UUID profileId) {
    UserProfile profile = profileService.require(user, profileId);
    PlaybackProgress record =
        progress
            .findById(progressId)
            .orElseThrow(() -> new NotFoundException("No such progress entry."));
    if (!record.getProfile().getId().equals(profile.getId())) {
      throw new NotFoundException("No such progress entry.");
    }
    progress.delete(record);
  }

  // ------------------------------------------------------------------- history

  @Transactional(readOnly = true)
  public List<HistoryDto> history(AppUser user, UUID profileId, int limit) {
    UserProfile profile = profileService.require(user, profileId);
    return history.findRecent(profile.getId(), PageRequest.of(0, Math.max(1, Math.min(limit, 200))))
        .stream()
        .map(HistoryDto::from)
        .toList();
  }

  /** Called after saveProgress so the history feed shows what was just watched. */
  public void recordHistory(AppUser user, UserProfile profile, ProgressRequest request) {
    WatchHistory entry = new WatchHistory();
    entry.setUser(user);
    entry.setProfile(profile);
    if (request.episodeId() != null && request.showKey() != null) {
      shows
          .findByKey(request.showKey())
          .ifPresent(
              show ->
                  show.getEpisodes().stream()
                      .filter(candidate -> request.episodeId().equals(candidate.getExternalId()))
                      .findFirst()
                      .ifPresent(entry::setEpisode));
    } else if (request.promoId() != null) {
      promos.findByExternalId(request.promoId()).ifPresent(entry::setPromo);
    }
    entry.setProgressSeconds(request.positionSeconds());
    entry.setWatchedAt(Instant.now());
    history.save(entry);
  }

  // ------------------------------------------------------------------ helpers

  private static boolean isComplete(ProgressRequest request) {
    return request.durationSeconds() > 0
        && request.positionSeconds() >= request.durationSeconds() * 0.95;
  }

  private static java.util.Map<String, Object> summarise(Show show) {
    return java.util.Map.of(
        "key", show.getKey(),
        "title", show.getTitle(),
        "subtitle", show.getSubtitle() == null ? "" : show.getSubtitle(),
        "image", show.getImageUrl() == null ? "" : show.getImageUrl(),
        "episodeCount", show.getEpisodes().size());
  }
}
