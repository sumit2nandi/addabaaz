package in.addabaaz.engagement.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateProfileRequest(
    @NotBlank @Size(max = 60) String name,
    boolean kids,
    @Size(max = 10) String pin,
    String avatarUrl) {}
