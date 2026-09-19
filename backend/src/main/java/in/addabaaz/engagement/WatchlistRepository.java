package in.addabaaz.engagement;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WatchlistRepository extends JpaRepository<Watchlist, UUID> {

  @Query(
      """
      select w from Watchlist w
      join fetch w.show s
      where w.profile.id = :profileId
      order by w.createdAt desc
      """)
  List<Watchlist> findByProfileWithShow(@Param("profileId") UUID profileId);

  Optional<Watchlist> findByProfileIdAndShowId(UUID profileId, UUID showId);

  long deleteByProfileIdAndShowId(UUID profileId, UUID showId);
}
