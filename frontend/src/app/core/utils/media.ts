import { Show, VideoMetadata } from '../models/content';

/** Best available thumbnail for a YouTube item, with a local fallback. */
export function youtubeThumbnail(youtubeId: string | undefined, fallbackImage = ''): string {
  if (!youtubeId) return fallbackImage;
  return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
}

/** `EP 03`, `PROMO`, `SPECIAL` … the small badge shown on episode cards. */
export function videoLabel(ep: Pick<VideoMetadata, 'kind' | 'episode'> | null | undefined): string {
  if (!ep) return 'EPISODE';
  if (ep.kind === 'PROMO') return 'PROMO';
  if (ep.kind === 'SPECIAL') return 'SPECIAL';
  if (ep.episode) return 'EP ' + String(ep.episode).padStart(2, '0');
  return 'EPISODE';
}

/** Poster used on show cards: the curated image, else the first episode thumb. */
export function showPoster(show: Show): string {
  return show.image || show.episodes[0]?.thumbnail || '';
}

/**
 * Builds a URL for a file inside an asset folder.
 * Only the filename is encoded — folder names are already URL safe.
 */
export function mediaUrl(folder: string, file: string): string {
  return folder + encodeURIComponent(file);
}

/** `"12,345"` → `12345`. */
export function parseViews(value: string | number | undefined): number {
  return Number(String(value ?? '').replace(/,/g, '')) || 0;
}

export function totalViews(show: Show): number {
  return show.episodes.reduce((sum, ep) => sum + parseViews(ep.views), 0);
}

export function isPlayable(video: Pick<VideoMetadata, 'youtubeId' | 'availability'>): boolean {
  return !!video.youtubeId && video.availability === 'available';
}

/** Pads an episode number the way the player subtitle does: `Episode 03`. */
export function episodeNumberLabel(episode: number | undefined): string {
  return String(episode ?? 1).padStart(2, '0');
}
