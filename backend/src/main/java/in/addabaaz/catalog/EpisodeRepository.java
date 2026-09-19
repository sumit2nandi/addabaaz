package in.addabaaz.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface EpisodeRepository extends JpaRepository<Episode, UUID> {

  List<Episode> findAllByShowKeyOrderByEpisodeNoAscPositionAsc(String showKey);

  Optional<Episode> findByShowKeyAndExternalId(String showKey, String externalId);

  @Query(
      """
      select e from Episode e
      where e.episodeNo > :episodeNo and e.show.key = :showKey
      order by e.episodeNo asc, e.position asc
      """)
  List<Episode> findNextEpisodes(@Param("showKey") String showKey, @Param("episodeNo") int episodeNo);
}
