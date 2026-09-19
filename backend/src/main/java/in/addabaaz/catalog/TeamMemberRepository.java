package in.addabaaz.catalog;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamMemberRepository extends JpaRepository<TeamMember, UUID> {

  List<TeamMember> findAllByPublishedTrueOrderBySortOrderAsc();
}
