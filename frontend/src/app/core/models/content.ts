/**
 * Domain models for the ADDABAAZ catalogue.
 *
 * These are the shapes the UI works with. They are built from the API payloads
 * in `core/models/api.ts` by `ContentService` — every show, episode, promo,
 * poster, team member and service now comes from the database.
 */

export type VideoKind = 'EPISODE' | 'PROMO' | 'SPECIAL';

/** Fields shared by every YouTube-backed item (episodes, promos, specials). */
export interface VideoMetadata {
  id: string;
  position: number;
  title: string;
  youtubeId: string;
  publishDate: string;
  /** Runtime formatted as `MM:SS`. */
  duration: string;
  /** View count as returned by the source export — kept as a string. */
  views: string;
  thumbnail: string;
  availability: string;
  kind?: VideoKind;
  /** Present on some exports when a short-form item belongs to a project. */
  project?: string;
  /** Present on a few short-form exports that were numbered like episodes. */
  episode?: number;
}

export interface Episode extends VideoMetadata {
  project?: string;
  episode?: number;
  kind: VideoKind;
}

export interface PromoVideo extends VideoMetadata {
  kind: VideoKind;
}

export interface Show {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  genre: string;
  episodes: Episode[];
  videoCount: number;
}

/** A poster sitting in the `UpcomingReleases/` or `BTS/` folder. */
export interface PosterItem {
  file: string;
  /** Optional caption — blank titles render the poster on its own. */
  title: string;
}

/** One slide of the homepage hero carousel. */
export interface HeroSlide {
  key: string;
  show: Show;
  previewEpisode: Episode;
  thumbnail: string;
  youtubeId: string | null;
}

export interface TeamMember {
  name: string;
  role: string;
  image: string;
  quote?: string;
}

export interface ServiceItem {
  num: string;
  title: string;
  description: string;
}
