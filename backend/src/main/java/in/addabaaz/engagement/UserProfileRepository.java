package in.addabaaz.engagement;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserProfileRepository extends JpaRepository<UserProfile, UUID> {

  List<UserProfile> findAllByUserIdOrderByIsDefaultDescNameAsc(UUID userId);

  Optional<UserProfile> findByIdAndUserId(UUID id, UUID userId);

  Optional<UserProfile> findByUserIdAndIsDefaultTrue(UUID userId);

  boolean existsByUserIdAndNameIgnoreCase(UUID userId, String name);
}
