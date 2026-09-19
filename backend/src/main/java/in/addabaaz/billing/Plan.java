package in.addabaaz.billing;

import java.math.BigDecimal;
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

@Entity
@Table(name = "plan")
@Getter
@Setter
public class Plan {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Column(nullable = false, unique = true, length = 40)
  private String code;

  @Column(nullable = false, length = 80)
  private String name;

  @Column(columnDefinition = "text")
  private String description;

  @Column(name = "price_inr", nullable = false, precision = 10, scale = 2)
  private BigDecimal priceInr = BigDecimal.ZERO;

  @Column(nullable = false, length = 3)
  private String currency = "INR";

  @Column(name = "duration_days", nullable = false)
  private int durationDays = 30;

  @Column(name = "max_screens", nullable = false)
  private int maxScreens = 1;

  /** SD | HD | FULL_HD | UHD. */
  @Column(nullable = false, length = 20)
  private String quality = "HD";

  @Column(nullable = false)
  private boolean active = true;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
