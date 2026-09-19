package in.addabaaz.engagement.dto;

import java.util.UUID;

import jakarta.validation.constraints.NotBlank;

public record WatchlistRequest(@NotBlank String showKey, UUID profileId) {}
