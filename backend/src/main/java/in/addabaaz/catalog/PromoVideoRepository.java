package in.addabaaz.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PromoVideoRepository extends JpaRepository<PromoVideo, UUID> {

  List<PromoVideo> findAllByOrderByPositionDesc();

  Optional<PromoVideo> findByExternalId(String externalId);

  List<PromoVideo> findAllByKindOrderByPositionDesc(String kind);
}
