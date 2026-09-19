import { Injectable, computed, signal } from '@angular/core';

import {
  BEHIND_THE_SCENES,
  BTS_FOLDER,
  BTS_HOME_LIMIT,
  FEATURED_UPCOMING_FILE,
  UPCOMING_FOLDER,
  UPCOMING_HOME_LIMIT,
  UPCOMING_RELEASES,
} from '../data/gallery.data';
import { PROMO_VIDEOS } from '../data/promos.data';
import { SHOWS } from '../data/shows.data';
import { Episode, HeroSlide, PosterItem, PromoVideo, Show } from '../models/content';
import { mediaUrl, showPoster, totalViews, youtubeThumbnail } from '../utils/media';

/** Posters that exist on disk but should stay out of the homepage rail. */
const HIDDEN_UPCOMING_FILES = new Set(['ChatGPT Image Jun 11, 2026, 03_00_37 AM.png']);

const PROMOS_PER_ROW = 10;

/**
 * Read-only access to the ADDABAAZ catalogue.
 *
 * Everything is derived from the static data files with signals, so adding a
 * new episode / promo / poster is a data edit and nothing else.
 */
@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly shows = signal<Show[]>(SHOWS);
  private readonly promos = signal<PromoVideo[]>(PROMO_VIDEOS);
  private readonly upcoming = signal<PosterItem[]>(UPCOMING_RELEASES);
  private readonly behindTheScenes = signal<PosterItem[]>(BEHIND_THE_SCENES);

  /** Shows that actually have something to play, most viewed first. */
  readonly rankedShows = computed(() =>
    this.shows()
      .filter((show) => show.episodes.length > 0)
      .slice()
      .sort((a, b) => totalViews(b) - totalViews(a)),
  );

  /** Top three shows drive the hero carousel. */
  readonly heroSlides = computed<HeroSlide[]>(() =>
    this.rankedShows()
      .slice(0, 3)
      .map((show) => {
        const previewEpisode =
          show.episodes.find((ep) => !!ep.youtubeId) ?? show.episodes[0] ?? null;
        return {
          key: show.key,
          show,
          previewEpisode,
          thumbnail: showPoster(show) || previewEpisode?.thumbnail || '',
          youtubeId: previewEpisode?.youtubeId ?? null,
        };
      })
      .filter((slide) => !!slide.previewEpisode),
  );

  /** Promos & specials, split into rows of ten for the homepage rails. */
  readonly promoRows = computed(() => {
    const promos = this.promos().filter((video) => video.kind === 'PROMO');
    const rows: PromoVideo[][] = [];
    for (let i = 0; i < promos.length; i += PROMOS_PER_ROW) {
      rows.push(promos.slice(i, i + PROMOS_PER_ROW));
    }
    return rows;
  });

  readonly upcomingHome = computed(() =>
    this.upcoming()
      .filter((item) => !HIDDEN_UPCOMING_FILES.has(item.file))
      .slice(0, UPCOMING_HOME_LIMIT),
  );
  readonly upcomingAll = computed(() => this.upcoming());
  readonly behindTheScenesHome = computed(() => this.behindTheScenes().slice(0, BTS_HOME_LIMIT));
  readonly behindTheScenesAll = computed(() => this.behindTheScenes());

  /** Full-size "Releasing This Month" poster on the homepage. */
  readonly featuredUpcoming = computed(() => mediaUrl(UPCOMING_FOLDER, FEATURED_UPCOMING_FILE));

  readonly upcomingFolder = UPCOMING_FOLDER;
  readonly btsFolder = BTS_FOLDER;

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
}
