package in.addabaaz.catalog;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** JSONB key/value store: contact details, social links, site copy, homepage limits. */
@Entity
@Table(name = "site_setting")
@Getter
@Setter
public class SiteSetting {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Column(nullable = false, unique = true, length = 80)
  private String key;

  /** Raw JSON text stored in a jsonb column (the JDBC URL sets stringtype=unspecified). */
  @Column(nullable = false)
  private String value;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt = Instant.now();

  @PreUpdate
  void onUpdate() {
    this.updatedAt = Instant.now();
  }
}
