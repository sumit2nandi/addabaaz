package in.addabaaz.catalog;

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
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(
    name = "episode",
    uniqueConstraints = @UniqueConstraint(name = "uk_episode_show_external", columnNames = {"show_id", "external_id"}))
@Getter
@Setter
public class Episode {

  public enum Kind {
    EPISODE,
    PROMO,
    SPECIAL
  }

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "show_id", nullable = false)
  private Show show;

  /** Legacy id from the original data export ('v35'), also used in URLs. */
  @Column(name = "external_id", length = 40)
  private String externalId;

  @Column(nullable = false)
  private int position = 0;

  @Column(nullable = false, length = 500)
  private String title;

  @Column(name = "youtube_id", length = 40)
  private String youtubeId;

  /** Runtime as 'MM:SS'. */
  @Column(length = 10)
  private String duration;

  @Column(nullable = false)
  private long views = 0;

  @Column(name = "thumbnail_url")
  private String thumbnailUrl;

  /** 'available' | 'unavailable'. */
  @Column(nullable = false, length = 20)
  private String availability = "available";

  @Column(name = "episode_no")
  private Integer episodeNo;

  @Column(nullable = false, length = 20)
  private String kind = Kind.EPISODE.name();

  @Column(name = "publish_date")
  private Instant publishDate;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
