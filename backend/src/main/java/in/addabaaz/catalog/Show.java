package in.addabaaz.catalog;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "show")
@Getter
@Setter
public class Show {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  /** Stable slug used in URLs: /watch/{key}. */
  @Column(nullable = false, unique = true, length = 60)
  private String key;

  @Column(nullable = false, length = 200)
  private String title;

  @Column(length = 200)
  private String subtitle;

  @Column(columnDefinition = "text")
  private String description;

  @Column(name = "image_url")
  private String imageUrl;

  @Column(length = 80)
  private String genre;

  @Column(name = "sort_order", nullable = false)
  private int sortOrder = 0;

  @Column(nullable = false)
  private boolean published = true;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @OneToMany(mappedBy = "show", cascade = CascadeType.ALL, orphanRemoval = true)
  @OrderBy("episodeNo asc, position asc")
  private List<Episode> episodes = new ArrayList<>();

  @ManyToMany(fetch = FetchType.LAZY)
  @JoinTable(
      name = "show_genre",
      joinColumns = @JoinColumn(name = "show_id"),
      inverseJoinColumns = @JoinColumn(name = "genre_id"))
  private List<Genre> genres = new ArrayList<>();

  @ManyToMany(fetch = FetchType.LAZY)
  @JoinTable(
      name = "show_tag",
      joinColumns = @JoinColumn(name = "show_id"),
      inverseJoinColumns = @JoinColumn(name = "tag_id"))
  private List<Tag> tags = new ArrayList<>();

  @PrePersist
  void onCreate() {
    Instant now = Instant.now();
    this.createdAt = now;
    this.updatedAt = now;
  }

  @PreUpdate
  void onUpdate() {
    this.updatedAt = Instant.now();
  }

  public void addEpisode(Episode episode) {
    episodes.add(episode);
    episode.setShow(this);
  }
}
