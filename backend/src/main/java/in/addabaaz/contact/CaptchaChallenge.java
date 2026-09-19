package in.addabaaz.contact;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** Server-rendered CAPTCHA. Only the hash of the code is stored. */
@Entity
@Table(name = "captcha_challenge")
@Getter
@Setter
public class CaptchaChallenge {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Column(name = "code_hash", nullable = false, length = 128)
  private String codeHash;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  @Column(name = "consumed_at")
  private Instant consumedAt;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();

  public boolean isUsable() {
    return consumedAt == null && expiresAt.isAfter(Instant.now());
  }
}
