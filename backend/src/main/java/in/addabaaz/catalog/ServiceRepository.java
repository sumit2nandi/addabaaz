package in.addabaaz.catalog;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ServiceRepository extends JpaRepository<ServiceItem, UUID> {

  List<ServiceItem> findAllByPublishedTrueOrderBySortOrderAsc();
}
