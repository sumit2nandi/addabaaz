package in.addabaaz.catalog;

import java.util.List;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;

import in.addabaaz.catalog.dto.BannerDto;
import in.addabaaz.catalog.dto.EpisodeDto;
import in.addabaaz.catalog.dto.EpisodeResolutionDto;
import in.addabaaz.catalog.dto.HomeDto;
import in.addabaaz.catalog.dto.PosterDto;
import in.addabaaz.catalog.dto.PromoDto;
import in.addabaaz.catalog.dto.ServiceDto;
import in.addabaaz.catalog.dto.ShowDto;
import in.addabaaz.catalog.dto.ShowSummaryDto;
import in.addabaaz.catalog.dto.TeamMemberDto;

/** Public, read-only catalogue API consumed by the Angular site. */
@RestController
@RequestMapping("/api")
public class CatalogController {

  private final CatalogService catalog;

  public CatalogController(CatalogService catalog) {
    this.catalog = catalog;
  }

  @GetMapping("/health")
  ResponseEntity<Map<String, String>> health() {
    return ResponseEntity.ok(Map.of("status", "UP", "service", "addabaaz-api"));
  }

  /** Everything the landing page needs in a single round trip. */
  @GetMapping("/home")
  HomeDto home() {
    return catalog.home();
  }

  @GetMapping("/shows")
  List<ShowSummaryDto> shows() {
    return catalog.shows();
  }

  @GetMapping("/shows/{key}")
  ShowDto show(@PathVariable String key) {
    return catalog.show(key);
  }

  @GetMapping("/shows/{key}/episodes")
  List<EpisodeDto> episodes(@PathVariable String key) {
    return catalog.episodesOf(key);
  }

  /** The player route: /watch/:showKey/:episodeId. */
  @GetMapping("/shows/{key}/episodes/{episodeId}")
  EpisodeResolutionDto episode(@PathVariable String key, @PathVariable String episodeId) {
    return catalog.resolveEpisode(key, episodeId);
  }

  @GetMapping("/promos")
  List<PromoDto> promos(@RequestParam(required = false) String kind) {
    if (kind != null && !kind.isBlank()) {
      return catalog.promos().stream()
          .filter(promo -> kind.equalsIgnoreCase(promo.kind()))
          .toList();
    }
    return catalog.promos();
  }

  @GetMapping("/promos/{externalId}")
  PromoDto promo(@PathVariable String externalId) {
    return catalog.promo(externalId);
  }

  @GetMapping("/posters")
  List<PosterDto> posters(@RequestParam(defaultValue = "UPCOMING") String kind) {
    return catalog.posters(kind);
  }

  @GetMapping("/banners")
  List<BannerDto> banners() {
    return catalog.banners();
  }

  @GetMapping("/team")
  List<TeamMemberDto> team() {
    return catalog.team();
  }

  @GetMapping("/services")
  List<ServiceDto> services() {
    return catalog.services();
  }

  @GetMapping("/settings")
  Map<String, JsonNode> settings() {
    return catalog.settings();
  }

  @GetMapping("/settings/{key}")
  JsonNode setting(@PathVariable String key) {
    return catalog.setting(key);
  }
}
