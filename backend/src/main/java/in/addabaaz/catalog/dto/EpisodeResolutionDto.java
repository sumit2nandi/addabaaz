package in.addabaaz.catalog.dto;

import java.util.List;

/** A show, the episode selected for playback and the full episode list of that show. */
public record EpisodeResolutionDto(ShowDto show, EpisodeDto episode, List<EpisodeDto> episodes) {}
