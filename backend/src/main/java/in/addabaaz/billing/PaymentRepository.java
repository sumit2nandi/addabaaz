package in.addabaaz.billing;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface PaymentRepository extends JpaRepository<Payment, UUID> {

  List<Payment> findAllByUserIdOrderByCreatedAtDesc(UUID userId);
}
