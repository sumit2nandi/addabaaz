package in.addabaaz.admin;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import in.addabaaz.admin.dto.AdminRequests;
import in.addabaaz.catalog.Banner;
import in.addabaaz.catalog.CatalogService;
import in.addabaaz.catalog.Episode;
import in.addabaaz.catalog.Poster;
import in.addabaaz.catalog.PromoVideo;
import in.addabaaz.catalog.ServiceItem;
import in.addabaaz.catalog.Show;
import in.addabaaz.catalog.TeamMember;
import in.addabaaz.catalog.dto.EpisodeDto;
import in.addabaaz.catalog.dto.PromoDto;

/** CRUD for the catalogue. Guarded by ROLE_ADMIN in {@code SecurityConfig}. */
@RestController
@RequestMapping("/api/admin")
@Validated
public class AdminCatalogController {

  private final AdminCatalogService admin;
  private final CatalogService catalog;

  public AdminCatalogController(AdminCatalogService admin, CatalogService catalog) {
    this.admin = admin;
    this.catalog = catalog;
  }

  // -------------------------------------------------------------------- shows

  @PostMapping("/shows")
  ResponseEntity<Void> createShow(@Validated @RequestBody AdminRequests.ShowRequest request) {
    admin.createShow(request);
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @PutMapping("/shows/{key}")
  ResponseEntity<Void> updateShow(
      @PathVariable String key, @Validated @RequestBody AdminRequests.ShowRequest request) {
    admin.updateShow(key, request);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/shows/{key}")
  ResponseEntity<Void> deleteShow(@PathVariable String key) {
    admin.deleteShow(key);
    return ResponseEntity.noContent().build();
  }

  // ----------------------------------------------------------------- episodes

  @PostMapping("/shows/{key}/episodes")
  ResponseEntity<EpisodeDto> addEpisode(
      @PathVariable String key, @Validated @RequestBody AdminRequests.EpisodeRequest request) {
    Episode episode = admin.addEpisode(key, request);
    return ResponseEntity.status(HttpStatus.CREATED).body(EpisodeDto.from(episode));
  }

  @PutMapping("/shows/{key}/episodes/{externalId}")
  ResponseEntity<EpisodeDto> updateEpisode(
      @PathVariable String key,
      @PathVariable String externalId,
      @Validated @RequestBody AdminRequests.EpisodeRequest request) {
    return ResponseEntity.ok(EpisodeDto.from(admin.updateEpisode(key, externalId, request)));
  }

  @DeleteMapping("/shows/{key}/episodes/{externalId}")
  ResponseEntity<Void> deleteEpisode(
      @PathVariable String key, @PathVariable String externalId) {
    admin.deleteEpisode(key, externalId);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/shows/{key}/episodes:replace")
  ResponseEntity<Integer> replaceEpisodes(
      @PathVariable String key,
      @Validated @RequestBody List<AdminRequests.EpisodeRequest> requests) {
    return ResponseEntity.ok(admin.replaceEpisodes(key, requests));
  }

  // ------------------------------------------------------------------- promos

  @PostMapping("/promos")
  ResponseEntity<PromoDto> createPromo(@Validated @RequestBody AdminRequests.PromoRequest request) {
    PromoVideo promo = admin.createPromo(request);
    return ResponseEntity.status(HttpStatus.CREATED).body(PromoDto.from(promo));
  }

  @PutMapping("/promos/{externalId}")
  ResponseEntity<PromoDto> updatePromo(
      @PathVariable String externalId, @Validated @RequestBody AdminRequests.PromoRequest request) {
    return ResponseEntity.ok(PromoDto.from(admin.updatePromo(externalId, request)));
  }

  @DeleteMapping("/promos/{externalId}")
  ResponseEntity<Void> deletePromo(@PathVariable String externalId) {
    admin.deletePromo(externalId);
    return ResponseEntity.noContent().build();
  }

  // ------------------------------------------------------------------ posters

  @PostMapping("/posters")
  ResponseEntity<Void> createPoster(@Validated @RequestBody AdminRequests.PosterRequest request) {
    Poster poster = admin.createPoster(request);
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @PutMapping("/posters/{id}")
  ResponseEntity<Void> updatePoster(
      @PathVariable UUID id, @Validated @RequestBody AdminRequests.PosterRequest request) {
    admin.updatePoster(id, request);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/posters/{id}")
  ResponseEntity<Void> deletePoster(@PathVariable UUID id) {
    admin.deletePoster(id);
    return ResponseEntity.noContent().build();
  }

  // ------------------------------------------------------------------ banners

  @PostMapping("/banners")
  ResponseEntity<Void> createBanner(@Validated @RequestBody AdminRequests.BannerRequest request) {
    Banner banner = admin.createBanner(request);
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @PutMapping("/banners/{id}")
  ResponseEntity<Void> updateBanner(
      @PathVariable UUID id, @Validated @RequestBody AdminRequests.BannerRequest request) {
    admin.updateBanner(id, request);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/banners/{id}")
  ResponseEntity<Void> deleteBanner(@PathVariable UUID id) {
    admin.deleteBanner(id);
    return ResponseEntity.noContent().build();
  }

  // --------------------------------------------------------------- team/svcs

  @PostMapping("/team")
  ResponseEntity<Void> createTeamMember(@Validated @RequestBody AdminRequests.TeamRequest request) {
    TeamMember member = admin.createTeamMember(request);
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @PutMapping("/team/{id}")
  ResponseEntity<Void> updateTeamMember(
      @PathVariable UUID id, @Validated @RequestBody AdminRequests.TeamRequest request) {
    admin.updateTeamMember(id, request);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/team/{id}")
  ResponseEntity<Void> deleteTeamMember(@PathVariable UUID id) {
    admin.deleteTeamMember(id);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/services")
  ResponseEntity<Void> createService(@Validated @RequestBody AdminRequests.ServiceRequest request) {
    ServiceItem service = admin.createService(request);
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @PutMapping("/services/{id}")
  ResponseEntity<Void> updateService(
      @PathVariable UUID id, @Validated @RequestBody AdminRequests.ServiceRequest request) {
    admin.updateService(id, request);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/services/{id}")
  ResponseEntity<Void> deleteService(@PathVariable UUID id) {
    admin.deleteService(id);
    return ResponseEntity.noContent().build();
  }

  // ----------------------------------------------------------------- settings

  @PutMapping("/settings/{key}")
  ResponseEntity<Void> putSetting(@PathVariable String key, @RequestBody String json) {
    admin.putSetting(key, json);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/settings/{key}")
  ResponseEntity<Void> deleteSetting(@PathVariable String key) {
    admin.deleteSetting(key);
    return ResponseEntity.noContent().build();
  }

  /** Admin views of the catalogue (includes unpublished rows). */
  @GetMapping("/shows")
  List<Show> allShows() {
    return catalog.showsAdmin();
  }
}
