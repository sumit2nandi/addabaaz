package in.addabaaz.engagement;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import in.addabaaz.engagement.dto.RatingDto;
import in.addabaaz.engagement.dto.RatingRequest;
import in.addabaaz.engagement.dto.ReviewDto;
import in.addabaaz.engagement.dto.ReviewRequest;
import in.addabaaz.security.AppUserDetails;

@RestController
@RequestMapping("/api")
@Validated
public class ReviewController {

  private final ReviewService reviews;
  private final RatingService ratings;

  public ReviewController(ReviewService reviews, RatingService ratings) {
    this.reviews = reviews;
    this.ratings = ratings;
  }

  // ------------------------------------------------------------------ reviews

  @GetMapping("/shows/{key}/reviews")
  List<ReviewDto> forShow(
      @PathVariable String key,
      @AuthenticationPrincipal AppUserDetails principal,
      @RequestParam(defaultValue = "true") boolean approvedOnly) {
    return reviews.forShow(key, principal == null ? null : principal.getUser(), approvedOnly);
  }

  @PostMapping("/shows/{key}/reviews")
  ResponseEntity<ReviewDto> create(
      @AuthenticationPrincipal AppUserDetails principal,
      @PathVariable String key,
      @Validated @RequestBody ReviewRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(reviews.create(principal.getUser(), key, request));
  }

  @DeleteMapping("/reviews/{id}")
  ResponseEntity<Void> delete(
      @AuthenticationPrincipal AppUserDetails principal, @PathVariable UUID id) {
    reviews.deleteOwn(principal.getUser(), id);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/me/reviews")
  List<ReviewDto> mine(@AuthenticationPrincipal AppUserDetails principal) {
    return reviews.mine(principal.getUser());
  }

  // ------------------------------------------------------------------ ratings

  @GetMapping("/shows/{key}/rating")
  RatingDto rating(@PathVariable String key) {
    return ratings.forShow(key);
  }

  @GetMapping("/me/ratings/{key}")
  RatingDto myRating(@AuthenticationPrincipal AppUserDetails principal, @PathVariable String key) {
    return ratings.mine(principal.getUser(), key);
  }

  @PutMapping("/shows/{key}/rating")
  RatingDto rate(
      @AuthenticationPrincipal AppUserDetails principal,
      @PathVariable String key,
      @Validated @RequestBody RatingRequest request) {
    return ratings.rate(principal.getUser(), key, request.score());
  }

  @DeleteMapping("/shows/{key}/rating")
  ResponseEntity<Void> clearRating(
      @AuthenticationPrincipal AppUserDetails principal, @PathVariable String key) {
    ratings.clear(principal.getUser(), key);
    return ResponseEntity.noContent().build();
  }
}
