package in.addabaaz.catalog;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PosterRepository extends JpaRepository<Poster, UUID> {

  List<Poster> findAllByKindAndPublishedTrueOrderBySortOrderAsc(String kind);

  List<Poster> findAllByKindOrderBySortOrderAsc(String kind);
}
