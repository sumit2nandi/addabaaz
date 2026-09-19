package in.addabaaz.user;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

  Optional<RefreshToken> findByTokenHash(String tokenHash);

  List<RefreshToken> findByUserIdAndRevokedAtIsNull(UUID userId);

  List<RefreshToken> findAllByFamilyId(UUID familyId);

  @Modifying
  int deleteByExpiresAtBefore(Instant cutoff);
}
