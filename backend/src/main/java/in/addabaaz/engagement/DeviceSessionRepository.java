package in.addabaaz.engagement;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DeviceSessionRepository extends JpaRepository<DeviceSession, UUID> {

  List<DeviceSession> findAllByUserIdAndRevokedAtIsNullOrderByLastSeenAtDesc(UUID userId);
}
