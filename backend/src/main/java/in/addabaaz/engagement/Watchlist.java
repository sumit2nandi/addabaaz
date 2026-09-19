package in.addabaaz.engagement;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.catalog.Show;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(
    name = "watchlist",
    uniqueConstraints = @UniqueConstraint(name = "uk_watchlist", columnNames = {"profile_id", "show_id"}))
@Getter
@Setter
public class Watchlist {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private in.addabaaz.user.AppUser user;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "profile_id", nullable = false)
  private UserProfile profile;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "show_id", nullable = false)
  private Show show;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
