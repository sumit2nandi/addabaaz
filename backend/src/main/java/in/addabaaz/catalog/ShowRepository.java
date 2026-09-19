package in.addabaaz.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ShowRepository extends JpaRepository<Show, UUID> {

  Optional<Show> findByKey(String key);

  List<Show> findAllByPublishedTrueOrderBySortOrderAsc();
}
