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
import lombok.Getter;
import lombok.Setter;

/** Hero carousel slide. */
@Entity
@Table(name = "banner")
@Getter
@Setter
public class Banner {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "show_id")
  private Show show;

  @Column(length = 200)
  private String title;

  @Column(length = 200)
  private String subtitle;

  @Column(name = "image_url")
  private String imageUrl;

  /** Optional ambient YouTube clip played behind the slide. */
  @Column(name = "youtube_id", length = 40)
  private String youtubeId;

  @Column(name = "cta_label", length = 40)
  private String ctaLabel = "Watch now";

  @Column(name = "sort_order", nullable = false)
  private int sortOrder = 0;

  @Column(nullable = false)
  private boolean active = true;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
