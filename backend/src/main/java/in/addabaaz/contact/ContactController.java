package in.addabaaz.contact;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import in.addabaaz.contact.dto.InquiryDto;
import in.addabaaz.contact.dto.InquiryRequest;
import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api/contact")
@Validated
public class ContactController {

  private final CaptchaService captcha;
  private final ContactInquiryRepository inquiries;

  public ContactController(CaptchaService captcha, ContactInquiryRepository inquiries) {
    this.captcha = captcha;
    this.inquiries = inquiries;
  }

  /** Fresh CAPTCHA image for the contact form. */
  @GetMapping("/captcha")
  CaptchaService.Challenge captcha() {
    return captcha.issue();
  }

  @PostMapping("/inquiries")
  ResponseEntity<InquiryDto> submit(
      @Validated @RequestBody InquiryRequest request, HttpServletRequest httpRequest) {
    captcha.verify(request.captchaId(), request.captchaCode());

    ContactInquiry inquiry = new ContactInquiry();
    inquiry.setName(request.name().trim());
    inquiry.setEmail(request.email().trim().toLowerCase());
    inquiry.setPhone(request.phone());
    inquiry.setMessage(request.message().trim());
    inquiry.setPage(request.page());
    inquiry.setStatus(ContactInquiry.Status.NEW.name());
    inquiry.setIpAddress(httpRequest == null ? null : httpRequest.getRemoteAddr());

    return ResponseEntity.status(HttpStatus.CREATED)
        .body(InquiryDto.from(inquiries.save(inquiry)));
  }
}
