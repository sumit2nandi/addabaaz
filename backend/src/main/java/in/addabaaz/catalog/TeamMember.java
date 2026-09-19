package in.addabaaz.catalog;

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
@Table(name = "team_member")
@Getter
@Setter
public class TeamMember {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Column(nullable = false, length = 120)
  private String name;

  /** Emoji + designation, e.g. '🎬 Creative Director'. */
  @Column(length = 120)
  private String role;

  @Column(name = "image_url")
  private String imageUrl;

  @Column(columnDefinition = "text")
  private String quote;

  @Column(name = "sort_order", nullable = false)
  private int sortOrder = 0;

  @Column(nullable = false)
  private boolean published = true;
}
