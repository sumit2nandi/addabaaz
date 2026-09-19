package in.addabaaz.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface SiteSettingRepository extends JpaRepository<SiteSetting, UUID> {

  Optional<SiteSetting> findByKey(String key);

  List<SiteSetting> findAllByOrderByKeyAsc();
}
