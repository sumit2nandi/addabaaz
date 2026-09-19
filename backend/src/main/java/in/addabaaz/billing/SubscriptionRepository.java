package in.addabaaz.billing;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {

  @SuppressWarnings("unused")
  List<Subscription> findAllByUserIdOrderByCreatedAtDesc(UUID userId);

  @SuppressWarnings("unused")
  Optional<Subscription> findTopByUserIdAndStatusOrderByEndsAtDesc(UUID userId, String status);

  @SuppressWarnings("unused")
  List<Subscription> findAllByStatusAndEndsAtBefore(String status, Instant cutoff);
}
