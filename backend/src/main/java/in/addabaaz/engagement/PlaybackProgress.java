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
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/** "Continue watching" — one row per profile per video. */
@Entity
@Table(
    name = "playback_progress",
    uniqueConstraints = {
      @UniqueConstraint(name = "uk_progress_episode", columnNames = {"profile_id", "episode_id"}),
      @UniqueConstraint(name = "uk_progress_promo", columnNames = {"profile_id", "promo_id"})
    })
@Getter
@Setter
public class PlaybackProgress {

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

  @Column(name = "position_seconds", nullable = false)
  private int positionSeconds = 0;

  @Column(name = "duration_seconds", nullable = false)
  private int durationSeconds = 0;

  @Column(nullable = false)
  private boolean completed = false;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt = Instant.now();
}
