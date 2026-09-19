package in.addabaaz.contact;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ContactInquiryRepository extends JpaRepository<ContactInquiry, UUID> {

  List<ContactInquiry> findAllByOrderByCreatedAtDesc();

  List<ContactInquiry> findAllByStatusOrderByCreatedAtDesc(String status);
}
