import { DestroyRef, computed, inject, signal } from '@angular/core';
import { Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';

import {
  ApiBanner,
  ApiContact,
  ApiEpisode,
  ApiHome,
  ApiPoster,
  ApiPromo,
  ApiServiceItem,
  ApiSettings,
  ApiShow,
  ApiSocialLink,
  ApiTeamMember,
} from '../models/api';
import { Episode, HeroSlide, PosterItem, PromoVideo, ServiceItem, Show, TeamMember, VideoKind } from '../models/content';
import { mediaUrl, showPoster, totalViews, youtubeThumbnail } from '../utils/media';
import { ApiService } from './api.service';

const DEFAULT_UPCOMING_FOLDER = 'UpcomingReleases/';
const DEFAULT_BTS_FOLDER = 'BTS/';
const DEFAULT_LIMITS = { upcoming: 10, bts: 10, promosPerRow: 10 };

interface HomeLimits {
  upcoming: number;
  bts: number;
  promosPerRow: number;
}

/**
 * Read-only access to the ADDABAAZ catalogue.
 *
 * Every list below is served by the Spring Boot API (`/api/home`, `/api/team`,
 * `/api/services`, `/api/settings`) — the site no longer ships any content of
 * its own, so the backend must be running.
 */
@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly shows = signal<Show[]>([]);
  private readonly promos = signal<PromoVideo[]>([]);
  private readonly upcoming = signal<PosterItem[]>([]);
  private readonly behindTheScenes = signal<PosterItem[]>([]);
  private readonly banners = signal<ApiBanner[]>([]);
  private readonly featured = signal<ApiPoster | null>(null);
  private readonly team = signal<TeamMember[]>([]);
  private readonly services = signal<ServiceItem[]>([]);
  private readonly settings = signal<ApiSettings>({});
  private readonly folders = signal({
    upcoming: DEFAULT_UPCOMING_FOLDER,
    bts: DEFAULT_BTS_FOLDER,
  });

  /** True until the first catalogue fetch settles. */
  readonly loading = signal(true);
  /** Set when the API cannot be reached — the UI shows a banner instead. */
  readonly error = signal<string | null>(null);

  constructor() {
    this.load();
  }

  /** Loads the whole catalogue. Safe to call again to pick up new content. */
  load(): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      home: this.api.home(),
      team: this.api.team(),
      services: this.api.services(),
      settings: this.api.settings(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ home, team, services, settings }) => {
          this.applyHome(home);
          this.team.set(team.map(mapTeamMember));
          this.services.set(services.map(mapService));
          this.settings.set(settings ?? {});
          this.loading.set(false);
        },
        error: () => {
          this.error.set(
            'The ADDABAAZ service is not responding. Start the API (backend/) and reload.',
          );
          this.loading.set(false);
        },
      });
  }

  // ------------------------------------------------------------------ catalogue

  /** Shows that actually have something to play, most viewed first. */
  readonly rankedShows = computed(() =>
    this.shows()
      .filter((show) => show.episodes.length > 0)
      .slice()
      .sort((a, b) => totalViews(b) - totalViews(a)),
  );

  /** Hero carousel: the banners curated in the database, else the top shows. */
  readonly heroSlides = computed<HeroSlide[]>(() => {
    const slides = this.banners()
      .map((banner) => this.slideFromBanner(banner))
      .filter((slide): slide is HeroSlide => slide !== null);

    if (slides.length > 0) return slides;

    return this.rankedShows()
      .slice(0, 3)
      .map((show) => {
        const previewEpisode = show.episodes.find((ep) => !!ep.youtubeId) ?? show.episodes[0] ?? null;
        return {
          key: show.key,
          show,
          previewEpisode,
          thumbnail: showPoster(show) || previewEpisode?.thumbnail || '',
          youtubeId: previewEpisode?.youtubeId ?? null,
        };
      })
      .filter((slide) => !!slide.previewEpisode);
  });

  /** Promos & specials, split into rows of ten for the homepage rails. */
  readonly promoRows = computed(() => {
    const promos = this.promos().filter((video) => video.kind === 'PROMO');
    const rows: PromoVideo[][] = [];
    const perRow = this.limits().promosPerRow;
    for (let i = 0; i < promos.length; i += perRow) {
      rows.push(promos.slice(i, i + perRow));
    }
    return rows;
  });

  readonly upcomingHome = computed(() =>
    this.upcoming()
      .filter((item) => !this.hiddenUpcomingFiles().has(item.file))
      .slice(0, this.limits().upcoming),
  );
  readonly upcomingAll = computed(() => this.upcoming());
  readonly behindTheScenesHome = computed(() => this.behindTheScenes().slice(0, this.limits().bts));
  readonly behindTheScenesAll = computed(() => this.behindTheScenes());

  /** Full-size "Releasing This Month" poster on the homepage. */
  readonly featuredUpcoming = computed(() => {
    const poster = this.featured();
    if (poster?.fileName) return mediaUrl(poster.folder || DEFAULT_UPCOMING_FOLDER, poster.fileName);
    const fromSettings = this.setting<{ folder?: string; fileName?: string }>('home.featuredUpcoming');
    if (fromSettings?.fileName) {
      return mediaUrl(fromSettings.folder || DEFAULT_UPCOMING_FOLDER, fromSettings.fileName);
    }
    return '';
  });

  readonly upcomingFolder = computed(() => this.folders().upcoming);
  readonly btsFolder = computed(() => this.folders().bts);

  readonly teamMembers = this.team.asReadonly();
  readonly serviceItems = this.services.asReadonly();
  readonly contactDetails = computed(() => this.setting<ApiContact>('contact'));
  readonly socialLinks = computed(() => this.setting<ApiSocialLink[]>('social') ?? []);
  readonly missionBengali = computed(() => this.setting<string[]>('mission.bengali') ?? []);
  readonly missionEnglish = computed(() => this.setting<string[]>('mission.english') ?? []);

  // -------------------------------------------------------------------- lookups

  getShow(key: string | null | undefined): Show | null {
    if (!key) return null;
    return this.shows().find((show) => show.key === key) ?? null;
  }

  getEpisode(show: Show | null, episodeId: string | null | undefined): Episode | null {
    if (!show) return null;
    if (!episodeId) return show.episodes[0] ?? null;
    return show.episodes.find((ep) => ep.id === episodeId) ?? show.episodes[0] ?? null;
  }

  getPromo(id: string | null | undefined): PromoVideo | null {
    if (!id) return null;
    return this.promos().find((video) => video.id === id) ?? null;
  }

  episodeThumbnail(episode: Episode, show: Show): string {
    return episode.thumbnail || youtubeThumbnail(episode.youtubeId, show.image);
  }

  // -------------------------------------------------------------------- internals

  private applyHome(home: ApiHome): void {
    this.shows.set((home.shows ?? []).map(mapShow));
    this.promos.set((home.promos ?? []).map(mapPromo));
    this.banners.set(home.banners ?? []);
    this.featured.set(home.featuredUpcoming ?? null);

    const upcoming = home.upcoming ?? [];
    const bts = home.behindTheScenes ?? [];
    this.upcoming.set(upcoming.map(mapPoster));
    this.behindTheScenes.set(bts.map(mapPoster));
    this.folders.set({
      upcoming: upcoming[0]?.folder || DEFAULT_UPCOMING_FOLDER,
      bts: bts[0]?.folder || DEFAULT_BTS_FOLDER,
    });
  }

  private slideFromBanner(banner: ApiBanner): HeroSlide | null {
    const show = banner.showKey ? this.getShow(banner.showKey) : null;
    if (!show) return null;

    const previewEpisode =
      (banner.youtubeId
        ? show.episodes.find((episode) => episode.youtubeId === banner.youtubeId)
        : undefined) ??
      show.episodes.find((episode) => !!episode.youtubeId) ??
      show.episodes[0] ??
      null;

    if (!previewEpisode) return null;

    return {
      key: show.key,
      show,
      previewEpisode,
      thumbnail: banner.image || showPoster(show) || previewEpisode.thumbnail || '',
      youtubeId: banner.youtubeId ?? previewEpisode.youtubeId ?? null,
    };
  }

  private setting<T>(key: string): T | null {
    const value = this.settings()[key];
    return (value as T) ?? null;
  }

  private readonly hiddenUpcomingFiles = computed(
    () => new Set(this.setting<string[]>('home.upcomingHiddenFiles') ?? []),
  );

  private readonly limits = computed<HomeLimits>(() => ({
    ...DEFAULT_LIMITS,
    ...(this.setting<Partial<HomeLimits>>('home.limits') ?? {}),
  }));
}

// ---------------------------------------------------------------------- mappers

function mapShow(dto: ApiShow): Show {
  const episodes = (dto.episodes ?? []).map((episode) => mapEpisode(episode, dto.key));
  return {
    key: dto.key,
    title: dto.title,
    subtitle: dto.subtitle ?? '',
    description: dto.description ?? '',
    image: dto.image ?? '',
    genre: dto.genre ?? '',
    episodes,
    videoCount: episodes.length,
  };
}

function mapEpisode(dto: ApiEpisode, showKey?: string): Episode {
  return {
    id: dto.id,
    position: dto.position ?? 0,
    title: dto.title,
    youtubeId: dto.youtubeId ?? '',
    publishDate: dto.publishDate ?? '',
    duration: dto.duration ?? '',
    views: String(dto.views ?? 0),
    thumbnail: dto.thumbnail ?? '',
    availability: dto.availability ?? 'available',
    kind: (dto.kind as VideoKind) ?? 'EPISODE',
    episode: dto.episodeNo ?? undefined,
    project: showKey,
  };
}

function mapPromo(dto: ApiPromo): PromoVideo {
  return {
    id: dto.id,
    position: dto.position ?? 0,
    title: dto.title,
    youtubeId: dto.youtubeId ?? '',
    publishDate: dto.publishDate ?? '',
    duration: dto.duration ?? '',
    views: String(dto.views ?? 0),
    thumbnail: dto.thumbnail ?? '',
    availability: dto.availability ?? 'available',
    kind: (dto.kind as VideoKind) ?? 'PROMO',
  };
}

function mapPoster(dto: ApiPoster): PosterItem {
  return { file: dto.fileName, title: dto.title ?? '' };
}

function mapTeamMember(dto: ApiTeamMember): TeamMember {
  return {
    name: dto.name,
    role: dto.role ?? '',
    image: dto.image ?? '',
    quote: dto.quote ?? undefined,
  };
}

function mapService(dto: ApiServiceItem): ServiceItem {
  return { num: dto.num, title: dto.title, description: dto.description ?? '' };
}
