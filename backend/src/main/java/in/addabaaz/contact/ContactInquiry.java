package in.addabaaz.contact;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** Message submitted through the Contact page. */
@Entity
@Table(name = "contact_inquiry")
@Getter
@Setter
public class ContactInquiry {

  public enum Status {
    NEW,
    READ,
    ARCHIVED
  }

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Column(nullable = false, length = 120)
  private String name;

  @Column(nullable = false, length = 190)
  private String email;

  @Column(length = 30)
  private String phone;

  @Column(nullable = false, columnDefinition = "text")
  private String message;

  /** Page the form was submitted from. */
  @Column(columnDefinition = "text")
  private String page;

  @Column(nullable = false, length = 20)
  private String status = Status.NEW.name();

  @Column(name = "ip_address", length = 64)
  private String ipAddress;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  @PrePersist
  void onCreate() {
    this.createdAt = Instant.now();
  }
}
