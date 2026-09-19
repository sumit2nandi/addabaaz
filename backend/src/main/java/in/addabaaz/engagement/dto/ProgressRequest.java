package in.addabaaz.engagement.dto;

import jakarta.validation.constraints.PositiveOrZero;

/**
 * Playback heartbeat from the player.
 * Either (showKey + episodeId) or promoId must be supplied.
 */
public record ProgressRequest(
    String showKey,
    String episodeId,
    String promoId,
    @PositiveOrZero int positionSeconds,
    @PositiveOrZero int durationSeconds,
    Boolean completed,
    java.util.UUID profileId) {}
