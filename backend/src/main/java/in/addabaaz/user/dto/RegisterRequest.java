package in.addabaaz.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
    @NotBlank @Email @Size(max = 190) String email,
    @NotBlank @Size(min = 8, max = 72) String password,
    @Size(max = 120) String fullName,
    @Size(max = 30) String phone) {}
