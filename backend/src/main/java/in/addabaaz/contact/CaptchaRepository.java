package in.addabaaz.contact;

import java.time.Instant;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

public interface CaptchaRepository extends JpaRepository<CaptchaChallenge, UUID> {

  @Modifying
  int deleteByExpiresAtBefore(Instant cutoff);
}
