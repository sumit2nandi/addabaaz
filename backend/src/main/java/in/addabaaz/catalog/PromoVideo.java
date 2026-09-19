package in.addabaaz.catalog;

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

/** Short-form upload: promo, reel or special. */
@Entity
@Table(name = "promo_video")
@Getter
@Setter
public class PromoVideo {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Column(name = "external_id", unique = true, length = 40)
  private String externalId;

  @Column(nullable = false)
  private int position = 0;

  @Column(nullable = false, length = 500)
  private String title;

  @Column(name = "youtube_id", length = 40)
  private String youtubeId;

  @Column(length = 10)
  private String duration;

  @Column(nullable = false)
  private long views = 0;

  @Column(name = "thumbnail_url")
  private String thumbnailUrl;

  @Column(nullable = false, length = 20)
  private String availability = "available";

  /** 'PROMO' | 'SPECIAL'. */
  @Column(nullable = false, length = 20)
  private String kind = "PROMO";

  @Column(name = "publish_date")
  private Instant publishDate;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
