/**
 * Shapes returned by the ADDABAAZ API (`backend/`).
 *
 * These mirror the Java records in `in.addabaaz.*.dto` one-to-one; the mapping
 * to the UI models in `core/models/content.ts` happens in `ContentService`.
 */

export type VideoKind = 'EPISODE' | 'PROMO' | 'SPECIAL';

export interface ApiEpisode {
  id: string;
  position: number;
  title: string;
  youtubeId: string;
  duration: string;
  views: number;
  thumbnail: string;
  availability: string;
  episodeNo: number | null;
  kind: VideoKind;
  publishDate: string | null;
}

export interface ApiShow {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  genre: string;
  genres: string[];
  tags: string[];
  averageRating: number;
  ratingCount: number;
  totalViews: number;
  episodes: ApiEpisode[];
}

export interface ApiPromo {
  id: string;
  position: number;
  title: string;
  youtubeId: string;
  duration: string;
  views: number;
  thumbnail: string;
  availability: string;
  kind: VideoKind;
  publishDate: string | null;
}

export interface ApiPoster {
  kind: string;
  folder: string;
  fileName: string;
  title: string | null;
  badge: string | null;
}

export interface ApiBanner {
  showKey: string | null;
  title: string;
  subtitle: string;
  image: string;
  youtubeId: string | null;
  ctaLabel: string;
}

export interface ApiHome {
  banners: ApiBanner[];
  shows: ApiShow[];
  promos: ApiPromo[];
  upcoming: ApiPoster[];
  behindTheScenes: ApiPoster[];
  featuredUpcoming: ApiPoster | null;
}

export interface ApiTeamMember {
  name: string;
  role: string;
  image: string;
  quote: string | null;
}

export interface ApiServiceItem {
  num: string;
  title: string;
  description: string;
}

/** site_setting rows, keyed by name, each holding arbitrary JSON. */
export type ApiSettings = Record<string, unknown>;

export interface ApiContact {
  email?: string;
  phones?: string[];
  landline?: string;
  whatsapp?: { number?: string; url?: string };
  address?: string[];
  mapsUrl?: string;
}

export interface ApiSocialLink {
  label?: string;
  icon?: string;
  url?: string;
}

// ---------------------------------------------------------------- auth & users

export interface ApiUser {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  authProvider: 'LOCAL' | 'GOOGLE';
  emailVerified: boolean;
  roles: string[];
  createdAt: string | null;
  lastLoginAt: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: ApiUser;
}

export interface RegisterPayload {
  email: string;
  password: string;
  fullName?: string;
  phone?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface ApiProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  kids: boolean;
  isDefault: boolean;
  createdAt: string;
}

export interface MeSummary {
  user: ApiUser;
  profiles: ApiProfile[];
  subscription: ApiSubscription | null;
}

// -------------------------------------------------------------------- billing

export interface ApiPlan {
  code: string;
  name: string;
  description: string | null;
  priceInr: number;
  currency: string;
  durationDays: number;
  maxScreens: number;
  quality: string;
  active: boolean;
}

export interface ApiSubscription {
  id: string;
  plan: ApiPlan;
  status: string;
  startedAt: string;
  endsAt: string;
  autoRenew: boolean;
  current: boolean;
}

export interface ApiPayment {
  id: string;
  amount: number;
  currency: string;
  gateway: string | null;
  gatewayReference: string | null;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

// ----------------------------------------------------------------- engagement

export interface ApiProgress {
  id: string;
  target: 'episode' | 'promo';
  episodeId: string | null;
  promoId: string | null;
  showKey: string | null;
  showTitle: string | null;
  title: string;
  thumbnail: string;
  youtubeId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: string;
}

export interface ApiHistory {
  id: string;
  target: 'episode' | 'promo';
  episodeId: string | null;
  promoId: string | null;
  showKey: string | null;
  title: string;
  thumbnail: string;
  progressSeconds: number;
  watchedAt: string;
}

export interface ProgressPayload {
  showKey?: string;
  episodeId?: string;
  promoId?: string;
  positionSeconds: number;
  durationSeconds: number;
  completed?: boolean;
  profileId?: string;
}

export interface ApiWatchlistEntry {
  key: string;
  title: string;
  subtitle: string;
  image: string;
  episodeCount: number;
}

export interface ApiReview {
  id: string;
  showKey: string;
  userId: string;
  author: string;
  title: string | null;
  body: string;
  spoiler: boolean;
  status: string;
  createdAt: string;
}

export interface ApiRating {
  showKey: string;
  myScore: number;
  averageScore: number;
  ratingCount: number;
}

export interface ApiDevice {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
}

// -------------------------------------------------------------------- contact

export interface CaptchaChallenge {
  id: string;
  /** `data:image/png;base64,…` — drop straight into an `<img>`. */
  image: string;
}

export interface ApiInquiry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  page: string | null;
  status: string;
  createdAt: string;
}
