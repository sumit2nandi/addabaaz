package in.addabaaz.user;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** Stored refresh token. Only the SHA-256 hash of the token is kept. */
@Entity
@Table(name = "refresh_token")
@Getter
@Setter
public class RefreshToken {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private AppUser user;

  @Column(name = "token_hash", nullable = false, unique = true, length = 128)
  private String tokenHash;

  /** Groups a rotation chain so a replayed token can invalidate its family. */
  @Column(name = "family_id", nullable = false)
  private UUID familyId;

  @Column(name = "expires_at", nullable = false)
  private Instant expiresAt;

  @Column(name = "revoked_at")
  private Instant revokedAt;

  @Column(name = "user_agent", length = 255)
  private String userAgent;

  @Column(name = "ip_address", length = 64)
  private String ipAddress;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();

  public boolean isUsable() {
    return revokedAt == null && expiresAt.isAfter(Instant.now());
  }
}
