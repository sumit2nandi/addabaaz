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

/** One card on the "Our Expertise" page. */
@Entity
@Table(name = "service")
@Getter
@Setter
public class ServiceItem {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  /** Display number, e.g. '01'. */
  @Column(nullable = false, length = 5)
  private String num;

  @Column(nullable = false, length = 120)
  private String title;

  @Column(columnDefinition = "text")
  private String description;

  @Column(name = "sort_order", nullable = false)
  private int sortOrder = 0;

  @Column(nullable = false)
  private boolean published = true;
}
