package in.addabaaz.catalog;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/** Poster image belonging to Upcoming Releases or Behind The Scenes. */
@Entity
@Table(
    name = "poster",
    uniqueConstraints =
        @UniqueConstraint(name = "uk_poster_file", columnNames = {"kind", "folder", "file_name"}))
@Getter
@Setter
public class Poster {

  public enum Kind {
    UPCOMING,
    BTS
  }

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Column(nullable = false, length = 20)
  private String kind = Kind.UPCOMING.name();

  /** Asset folder, e.g. 'UpcomingReleases/'. */
  @Column(nullable = false, length = 80)
  private String folder;

  @Column(name = "file_name", nullable = false, length = 200)
  private String fileName;

  @Column(length = 200)
  private String title;

  @Column(length = 40)
  private String badge;

  @Column(name = "sort_order", nullable = false)
  private int sortOrder = 0;

  @Column(nullable = false)
  private boolean published = true;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
