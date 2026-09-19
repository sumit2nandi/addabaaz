package in.addabaaz.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface GenreRepository extends JpaRepository<Genre, UUID> {

  Optional<Genre> findBySlug(String slug);

  List<Genre> findAllByOrderByNameAsc();

  Optional<Genre> findByNameIgnoreCase(String name);
}
