package in.addabaaz.engagement;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import in.addabaaz.catalog.Show;
import in.addabaaz.catalog.ShowRepository;
import in.addabaaz.common.NotFoundException;
import in.addabaaz.engagement.dto.ReviewDto;
import in.addabaaz.engagement.dto.ReviewRequest;
import in.addabaaz.user.AppUser;

@Service
@Transactional
public class ReviewService {

  private final ReviewRepository reviews;
  private final ShowRepository shows;

  public ReviewService(ReviewRepository reviews, ShowRepository shows) {
    this.reviews = reviews;
    this.shows = shows;
  }

  @Transactional(readOnly = true)
  public List<ReviewDto> forShow(String showKey, AppUser viewer, boolean approvedOnly) {
    Show show = requireShow(showKey);
    return reviews.findByShow(show.getId(), approvedOnly).stream()
        .map(ReviewDto::from)
        .toList();
  }

  public ReviewDto create(AppUser user, String showKey, ReviewRequest request) {
    Show show = requireShow(showKey);
    Review review = new Review();
    review.setUser(user);
    review.setShow(show);
    review.setTitle(request.title());
    review.setBody(request.body());
    review.setSpoiler(request.spoiler());
    review.setStatus(Review.Status.APPROVED.name());
    return ReviewDto.from(reviews.save(review));
  }

  public void deleteOwn(AppUser user, UUID reviewId) {
    Review review = reviews.findById(reviewId).orElseThrow(() -> new NotFoundException("No such review."));
    boolean owner = review.getUser().getId().equals(user.getId());
    if (!owner && !user.isAdmin()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You can only delete your own reviews.");
    }
    reviews.delete(review);
  }

  @Transactional(readOnly = true)
  public List<ReviewDto> mine(AppUser user) {
    return reviews.findAllByUserIdOrderByCreatedAtDesc(user.getId()).stream()
        .map(ReviewDto::from)
        .toList();
  }

  private Show requireShow(String showKey) {
    return shows.findByKey(showKey).orElseThrow(() -> new NotFoundException("No show '" + showKey + "'."));
  }
}
