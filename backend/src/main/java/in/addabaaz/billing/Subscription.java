package in.addabaaz.billing;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.user.AppUser;
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

@Entity
@Table(name = "subscription")
@Getter
@Setter
public class Subscription {

  public enum Status {
    ACTIVE,
    EXPIRED,
    CANCELLED,
    TRIAL
  }

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private AppUser user;

  @ManyToOne(fetch = FetchType.EAGER, optional = false)
  @JoinColumn(name = "plan_id", nullable = false)
  private Plan plan;

  @Column(nullable = false, length = 20)
  private String status = Status.ACTIVE.name();

  @Column(name = "started_at", nullable = false)
  private Instant startedAt = Instant.now();

  @Column(name = "ends_at", nullable = false)
  private Instant endsAt;

  @Column(name = "auto_renew", nullable = false)
  private boolean autoRenew = true;

  @Column(name = "cancelled_at")
  private Instant cancelledAt;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();

  public boolean isCurrent() {
    return Status.ACTIVE.name().equals(status) && endsAt.isAfter(Instant.now());
  }
}
