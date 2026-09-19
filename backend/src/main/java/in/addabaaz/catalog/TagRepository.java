package in.addabaaz.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TagRepository extends JpaRepository<Tag, UUID> {

  Optional<Tag> findBySlug(String slug);

  List<Tag> findAllByOrderByNameAsc();

  Optional<Tag> findByNameIgnoreCase(String name);
}
