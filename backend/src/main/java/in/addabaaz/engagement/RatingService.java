package in.addabaaz.engagement;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.catalog.Show;
import in.addabaaz.catalog.ShowRepository;
import in.addabaaz.common.NotFoundException;
import in.addabaaz.engagement.dto.RatingDto;
import in.addabaaz.user.AppUser;

@Service
@Transactional
public class RatingService {

  private final RatingRepository ratings;
  private final ShowRepository shows;

  public RatingService(RatingRepository ratings, ShowRepository shows) {
    this.ratings = ratings;
    this.shows = shows;
  }

  public RatingDto rate(AppUser user, String showKey, int score) {
    Show show = requireShow(showKey);
    Rating rating =
        ratings
            .findByUserIdAndShowId(user.getId(), show.getId())
            .orElseGet(
                () -> {
                  Rating created = new Rating();
                  created.setUser(user);
                  created.setShow(show);
                  return created;
                });
    rating.setScore(score);
    ratings.save(rating);
    return summary(show, rating);
  }

  @Transactional(readOnly = true)
  public RatingDto mine(AppUser user, String showKey) {
    Show show = requireShow(showKey);
    Rating rating = ratings.findByUserIdAndShowId(user.getId(), show.getId()).orElse(null);
    return summary(show, rating);
  }

  public void clear(AppUser user, String showKey) {
    Show show = requireShow(showKey);
    ratings.findByUserIdAndShowId(user.getId(), show.getId()).ifPresent(ratings::delete);
  }

  @Transactional(readOnly = true)
  public RatingDto forShow(String showKey) {
    Show show = requireShow(showKey);
    return summary(show, null);
  }

  @Transactional(readOnly = true)
  public List<RatingDto> allForUser(AppUser user) {
    return ratings.findAll().stream()
        .filter(rating -> rating.getUser().getId().equals(user.getId()))
        .map(rating -> summary(rating.getShow(), rating))
        .toList();
  }

  private RatingDto summary(Show show, Rating rating) {
    return new RatingDto(
        show.getKey(),
        rating == null ? 0 : rating.getScore(),
        ratings.averageScore(show.getId()),
        ratings.countByShow(show.getId()));
  }

  private Show requireShow(String showKey) {
    return shows.findByKey(showKey).orElseThrow(() -> new NotFoundException("No show '" + showKey + "'."));
  }

  @Transactional(readOnly = true)
  public RatingDto byId(UUID showId) {
    return summary(shows.findById(showId).orElseThrow(() -> new NotFoundException("No such show.")), null);
  }
}
