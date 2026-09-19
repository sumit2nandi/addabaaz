package in.addabaaz.engagement;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.catalog.Episode;
import in.addabaaz.catalog.PromoVideo;
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
@Table(name = "watch_history")
@Getter
@Setter
public class WatchHistory {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private in.addabaaz.user.AppUser user;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "profile_id", nullable = false)
  private UserProfile profile;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "episode_id")
  private Episode episode;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "promo_id")
  private PromoVideo promo;

  @Column(name = "progress_seconds", nullable = false)
  private int progressSeconds = 0;

  @Column(name = "watched_at", nullable = false)
  private Instant watchedAt = Instant.now();
}
