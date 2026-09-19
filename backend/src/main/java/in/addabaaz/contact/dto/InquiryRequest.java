package in.addabaaz.contact.dto;

import java.util.UUID;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record InquiryRequest(
    @NotBlank @Size(max = 120) String name,
    @NotBlank @Email @Size(max = 190) String email,
    @Size(max = 30) String phone,
    @NotBlank @Size(max = 4000) String message,
    String page,
    @NotNull UUID captchaId,
    @NotBlank String captchaCode) {}
