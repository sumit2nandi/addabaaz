package in.addabaaz.contact;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import in.addabaaz.common.NotFoundException;
import in.addabaaz.contact.dto.InquiryDto;

/** Inbox for the contact form — ROLE_ADMIN only (everything under /api/admin/**). */
@RestController
@RequestMapping("/api/admin/inquiries")
@Validated
public class AdminContactController {

  private final ContactInquiryRepository inquiries;

  public AdminContactController(ContactInquiryRepository inquiries) {
    this.inquiries = inquiries;
  }

  @GetMapping
  List<InquiryDto> list() {
    return inquiries.findAllByOrderByCreatedAtDesc().stream().map(InquiryDto::from).toList();
  }

  @GetMapping("/{id}")
  InquiryDto one(@PathVariable UUID id) {
    return InquiryDto.from(
        inquiries.findById(id).orElseThrow(() -> new NotFoundException("No such inquiry.")));
  }

  /** body: { "status": "READ" | "ARCHIVED" | "NEW" } */
  @PatchMapping("/{id}")
  ResponseEntity<InquiryDto> updateStatus(
      @PathVariable UUID id, @RequestBody Map<String, String> body) {
    ContactInquiry inquiry =
        inquiries.findById(id).orElseThrow(() -> new NotFoundException("No such inquiry."));
    String status = body.get("status");
    if (status != null && !status.isBlank()) {
      inquiry.setStatus(ContactInquiry.Status.valueOf(status.toUpperCase()).name());
    }
    return ResponseEntity.ok(InquiryDto.from(inquiries.save(inquiry)));
  }

  @DeleteMapping("/{id}")
  ResponseEntity<Void> delete(@PathVariable UUID id) {
    inquiries.delete(
        inquiries.findById(id).orElseThrow(() -> new NotFoundException("No such inquiry.")));
    return ResponseEntity.noContent().build();
  }
}
