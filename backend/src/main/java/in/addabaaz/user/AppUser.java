package in.addabaaz.user;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "app_user")
@Getter
@Setter
public class AppUser {

  public enum AuthProvider {
    LOCAL,
    GOOGLE
  }

  public enum Status {
    ACTIVE,
    SUSPENDED,
    DELETED
  }

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Column(nullable = false, length = 190)
  private String email;

  /** BCrypt hash — null for accounts that only ever sign in with Google. */
  @Column(name = "password_hash", length = 100)
  private String passwordHash;

  @Column(name = "full_name", length = 120)
  private String fullName;

  @Column(length = 30)
  private String phone;

  @Column(name = "avatar_url")
  private String avatarUrl;

  @Enumerated(EnumType.STRING)
  @Column(name = "auth_provider", nullable = false, length = 20)
  private AuthProvider authProvider = AuthProvider.LOCAL;

  @Column(name = "provider_id", length = 120)
  private String providerId;

  @Column(name = "email_verified", nullable = false)
  private boolean emailVerified = false;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private Status status = Status.ACTIVE;

  @Column(name = "last_login_at")
  private Instant lastLoginAt;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  @ManyToMany(fetch = FetchType.EAGER)
  @JoinTable(
      name = "user_role",
      joinColumns = @JoinColumn(name = "user_id"),
      inverseJoinColumns = @JoinColumn(name = "role_id"))
  private Set<Role> roles = new HashSet<>();

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

  public boolean isAdmin() {
    return roles.stream().anyMatch(role -> "ROLE_ADMIN".equals(role.getCode()));
  }
}
