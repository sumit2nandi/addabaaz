package in.addabaaz.engagement;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RatingRepository extends JpaRepository<Rating, UUID> {

  Optional<Rating> findByUserIdAndShowId(UUID userId, UUID showId);

  @Query("select coalesce(avg(r.score), 0.0) from Rating r where r.show.id = :showId")
  Double averageScore(@Param("showId") UUID showId);

  @Query("select count(r) from Rating r where r.show.id = :showId")
  long countByShow(@Param("showId") UUID showId);
}
