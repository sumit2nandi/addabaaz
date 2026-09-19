package in.addabaaz.engagement;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WatchHistoryRepository extends JpaRepository<WatchHistory, UUID> {

  @Query(
      """
      select h from WatchHistory h
      left join fetch h.episode e
      left join fetch e.show
      left join fetch h.promo
      where h.profile.id = :profileId
      order by h.watchedAt desc
      """)
  List<WatchHistory> findRecent(@Param("profileId") UUID profileId, org.springframework.data.domain.Pageable pageable);
}
