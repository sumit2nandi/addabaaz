package in.addabaaz.billing;

import java.math.BigDecimal;
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
@Table(name = "payment")
@Getter
@Setter
public class Payment {

  public enum Status {
    PENDING,
    PAID,
    FAILED,
    REFUNDED
  }

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "subscription_id")
  private Subscription subscription;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private AppUser user;

  @Column(nullable = false, precision = 10, scale = 2)
  private BigDecimal amount = BigDecimal.ZERO;

  @Column(nullable = false, length = 3)
  private String currency = "INR";

  /** RAZORPAY | STRIPE | MANUAL. */
  @Column(length = 40)
  private String gateway;

  @Column(name = "gateway_reference", length = 120)
  private String gatewayReference;

  @Column(nullable = false, length = 20)
  private String status = Status.PENDING.name();

  @Column(name = "paid_at")
  private Instant paidAt;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
