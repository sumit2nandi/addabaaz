package in.addabaaz.engagement;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.user.AppUser;
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

/** A Netflix-style profile inside an account (Kids, Parents, ...). */
@Entity
@Table(
    name = "user_profile",
    uniqueConstraints = @UniqueConstraint(name = "uk_profile_name", columnNames = {"user_id", "name"}))
@Getter
@Setter
public class UserProfile {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "user_id", nullable = false)
  private AppUser user;

  @Column(nullable = false, length = 60)
  private String name;

  @Column(name = "avatar_url")
  private String avatarUrl;

  @Column(name = "is_kids", nullable = false)
  private boolean kids = false;

  @Column(length = 10)
  private String pin;

  @Column(name = "is_default", nullable = false)
  private boolean isDefault = false;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt = Instant.now();
}
