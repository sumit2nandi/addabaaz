package in.addabaaz.engagement;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewRepository extends JpaRepository<Review, UUID> {

  @Query(
      """
      select r from Review r
      join fetch r.user u
      where r.show.id = :showId and (:approvedOnly = false or r.status = 'APPROVED')
      order by r.createdAt desc
      """)
  List<Review> findByShow(@Param("showId") UUID showId, @Param("approvedOnly") boolean approvedOnly);

  List<Review> findAllByUserIdOrderByCreatedAtDesc(UUID userId);
}
