package in.addabaaz.engagement;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PlaybackProgressRepository extends JpaRepository<PlaybackProgress, UUID> {

  @Query(
      """
      select p from PlaybackProgress p
      left join fetch p.episode e
      left join fetch e.show
      left join fetch p.promo
      where p.profile.id = :profileId and p.completed = false
      order by p.updatedAt desc
      """)
  List<PlaybackProgress> findContinueWatching(@Param("profileId") UUID profileId);

  Optional<PlaybackProgress> findByProfileIdAndEpisodeId(UUID profileId, UUID episodeId);

  Optional<PlaybackProgress> findByProfileIdAndPromoId(UUID profileId, UUID promoId);
}
