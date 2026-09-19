package in.addabaaz.engagement.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ReviewRequest(
    @Size(max = 200) String title,
    @NotBlank @Size(max = 4000) String body,
    boolean spoiler) {}
