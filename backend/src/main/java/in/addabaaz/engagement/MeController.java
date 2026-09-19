package in.addabaaz.engagement;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import in.addabaaz.engagement.dto.CreateProfileRequest;
import in.addabaaz.engagement.dto.DeviceDto;
import in.addabaaz.engagement.dto.HistoryDto;
import in.addabaaz.engagement.dto.ProfileDto;
import in.addabaaz.engagement.dto.ProgressDto;
import in.addabaaz.engagement.dto.ProgressRequest;
import in.addabaaz.engagement.dto.WatchlistRequest;
import in.addabaaz.security.AppUserDetails;
import in.addabaaz.user.AppUser;
import in.addabaaz.user.dto.UserDto;
import in.addabaaz.user.AppUser;
import jakarta.servlet.http.HttpServletRequest;

/** Everything that belongs to the signed-in account. */
@RestController
@RequestMapping("/api/me")
@Validated
public class MeController {

  private final ProfileService profileService;
  private final EngagementService engagement;
  private final DeviceService deviceService;
  private final in.addabaaz.billing.BillingService billing;

  public MeController(
      ProfileService profileService,
      EngagementService engagement,
      DeviceService deviceService,
      in.addabaaz.billing.BillingService billing) {
    this.profileService = profileService;
    this.engagement = engagement;
    this.deviceService = deviceService;
    this.billing = billing;
  }

  /** Signed-in account: identity, profiles and current subscription. */
  public record MeSummary(
      UserDto user,
      List<ProfileDto> profiles,
      in.addabaaz.billing.dto.SubscriptionDto subscription) {}

  /** Everything the app needs right after sign-in. */
  @GetMapping
  MeSummary me(@AuthenticationPrincipal AppUserDetails principal) {
    AppUser user = principal.getUser();
    return new MeSummary(
        UserDto.from(user),
        profileService.listFor(user.getId()).stream().map(ProfileDto::from).toList(),
        billing.current(user).orElse(null));
  }

  // ------------------------------------------------------------------ profiles

  @GetMapping("/profiles")
  List<ProfileDto> profiles(@AuthenticationPrincipal AppUserDetails principal) {
    return profileService.listFor(principal.getUser().getId()).stream().map(ProfileDto::from).toList();
  }

  @PostMapping("/profiles")
  ResponseEntity<ProfileDto> createProfile(
      @AuthenticationPrincipal AppUserDetails principal,
      @Validated @RequestBody CreateProfileRequest request) {
    UserProfile profile =
        profileService.create(
            principal.getUser(), request.name(), request.kids(), request.pin(), request.avatarUrl());
    return ResponseEntity.status(HttpStatus.CREATED).body(ProfileDto.from(profile));
  }

  @DeleteMapping("/profiles/{id}")
  ResponseEntity<Void> deleteProfile(
      @AuthenticationPrincipal AppUserDetails principal, @PathVariable UUID id) {
    profileService.delete(principal.getUser(), id);
    return ResponseEntity.noContent().build();
  }

  // ----------------------------------------------------------------- watchlist

  @GetMapping("/watchlist")
  List<Object> watchlist(
      @AuthenticationPrincipal AppUserDetails principal,
      @RequestParam(required = false) UUID profileId) {
    return engagement.watchlist(principal.getUser(), profileId);
  }

  @PostMapping("/watchlist")
  ResponseEntity<Object> addToWatchlist(
      @AuthenticationPrincipal AppUserDetails principal,
      @Validated @RequestBody WatchlistRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(engagement.addToWatchlist(principal.getUser(), request.showKey(), request.profileId()));
  }

  @DeleteMapping("/watchlist/{showKey}")
  ResponseEntity<Void> removeFromWatchlist(
      @AuthenticationPrincipal AppUserDetails principal,
      @PathVariable String showKey,
      @RequestParam(required = false) UUID profileId) {
    engagement.removeFromWatchlist(principal.getUser(), showKey, profileId);
    return ResponseEntity.noContent().build();
  }

  // ------------------------------------------------- continue watching/history

  @GetMapping("/continue-watching")
  List<ProgressDto> continueWatching(
      @AuthenticationPrincipal AppUserDetails principal,
      @RequestParam(required = false) UUID profileId) {
    return engagement.continueWatching(principal.getUser(), profileId);
  }

  @PostMapping("/progress")
  ResponseEntity<ProgressDto> saveProgress(
      @AuthenticationPrincipal AppUserDetails principal,
      @Validated @RequestBody ProgressRequest request) {
    AppUser user = principal.getUser();
    ProgressDto saved = engagement.saveProgress(user, request);
    engagement.recordHistory(
        user, profileService.require(user, request.profileId()), request);
    return ResponseEntity.ok(saved);
  }

  @DeleteMapping("/continue-watching/{id}")
  ResponseEntity<Void> deleteProgress(
      @AuthenticationPrincipal AppUserDetails principal,
      @PathVariable UUID id,
      @RequestParam(required = false) UUID profileId) {
    engagement.deleteProgress(principal.getUser(), id, profileId);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/history")
  List<HistoryDto> history(
      @AuthenticationPrincipal AppUserDetails principal,
      @RequestParam(required = false) UUID profileId,
      @RequestParam(defaultValue = "50") int limit) {
    return engagement.history(principal.getUser(), profileId, limit);
  }

  // ------------------------------------------------------------------ devices

  @GetMapping("/devices")
  List<DeviceDto> devices(@AuthenticationPrincipal AppUserDetails principal) {
    return deviceService.list(principal.getUser());
  }

  @PostMapping("/devices")
  ResponseEntity<DeviceDto> registerDevice(
      @AuthenticationPrincipal AppUserDetails principal, HttpServletRequest request) {
    DeviceSession session = deviceService.record(principal.getUser(), request);
    return ResponseEntity.status(HttpStatus.CREATED).body(DeviceDto.from(session));
  }

  @DeleteMapping("/devices/{id}")
  ResponseEntity<Void> revokeDevice(
      @AuthenticationPrincipal AppUserDetails principal, @PathVariable UUID id) {
    deviceService.revoke(principal.getUser(), id);
    return ResponseEntity.noContent().build();
  }
}
