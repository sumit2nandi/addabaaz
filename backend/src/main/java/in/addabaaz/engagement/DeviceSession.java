package in.addabaaz.engagement;

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

/** Tracks the devices an account has signed in from. */
@Entity
@Table(name = "device_session")
@Getter
@Setter
public class DeviceSession {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private in.addabaaz.user.AppUser user;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "profile_id")
  private UserProfile profile;

  @Column(name = "device_name", length = 80)
  private String deviceName;

  @Column(name = "user_agent", columnDefinition = "text")
  private String userAgent;

  @Column(name = "ip_address", length = 64)
  private String ipAddress;

  @Column(name = "last_seen_at", nullable = false)
  private Instant lastSeenAt = Instant.now();

  @Column(name = "revoked_at")
  private Instant revokedAt;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
