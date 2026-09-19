package in.addabaaz.contact.dto;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.contact.ContactInquiry;

public record InquiryDto(
    UUID id,
    String name,
    String email,
    String phone,
    String message,
    String page,
    String status,
    Instant createdAt) {

  public static InquiryDto from(ContactInquiry inquiry) {
    return new InquiryDto(
        inquiry.getId(),
        inquiry.getName(),
        inquiry.getEmail(),
        inquiry.getPhone(),
        inquiry.getMessage(),
        inquiry.getPage(),
        inquiry.getStatus(),
        inquiry.getCreatedAt());
  }
}
