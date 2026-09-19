import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  ApiBanner,
  ApiDevice,
  ApiHistory,
  ApiHome,
  ApiInquiry,
  ApiPayment,
  ApiPlan,
  ApiPoster,
  ApiProfile,
  ApiProgress,
  ApiPromo,
  ApiRating,
  ApiReview,
  ApiServiceItem,
  ApiSettings,
  ApiShow,
  ApiSubscription,
  ApiTeamMember,
  ApiWatchlistEntry,
  AuthResponse,
  CaptchaChallenge,
  LoginPayload,
  MeSummary,
  ProgressPayload,
  RegisterPayload,
} from '../models/api';
import { ApiConfig } from './api-config.service';

/** Thin, typed wrapper around every ADDABAAZ API endpoint. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApiConfig);

  private url(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }

  // ---------------------------------------------------------------- catalogue

  home(): Observable<ApiHome> {
    return this.http.get<ApiHome>(this.url('/home'));
  }

  shows(): Observable<ApiShow[]> {
    return this.http.get<ApiShow[]>(this.url('/shows'));
  }

  show(key: string): Observable<ApiShow> {
    return this.http.get<ApiShow>(this.url(`/shows/${encodeURIComponent(key)}`));
  }

  promos(kind?: string): Observable<ApiPromo[]> {
    const params = kind ? new HttpParams().set('kind', kind) : undefined;
    return this.http.get<ApiPromo[]>(this.url('/promos'), { params });
  }

  promo(id: string): Observable<ApiPromo> {
    return this.http.get<ApiPromo>(this.url(`/promos/${encodeURIComponent(id)}`));
  }

  posters(kind: 'UPCOMING' | 'BTS'): Observable<ApiPoster[]> {
    return this.http.get<ApiPoster[]>(this.url('/posters'), {
      params: new HttpParams().set('kind', kind),
    });
  }

  banners(): Observable<ApiBanner[]> {
    return this.http.get<ApiBanner[]>(this.url('/banners'));
  }

  team(): Observable<ApiTeamMember[]> {
    return this.http.get<ApiTeamMember[]>(this.url('/team'));
  }

  services(): Observable<ApiServiceItem[]> {
    return this.http.get<ApiServiceItem[]>(this.url('/services'));
  }

  settings(): Observable<ApiSettings> {
    return this.http.get<ApiSettings>(this.url('/settings'));
  }

  // --------------------------------------------------------------------- auth

  register(payload: RegisterPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(this.url('/auth/register'), payload);
  }

  login(payload: LoginPayload): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(this.url('/auth/login'), payload);
  }

  refresh(refreshToken: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(this.url('/auth/refresh'), { refreshToken });
  }

  logout(refreshToken: string | null): Observable<void> {
    return this.http.post<void>(this.url('/auth/logout'), { refreshToken });
  }

  logoutAll(): Observable<void> {
    return this.http.post<void>(this.url('/auth/logout-all'), {});
  }

  me(): Observable<MeSummary> {
    return this.http.get<MeSummary>(this.url('/me'));
  }

  // ----------------------------------------------------------------- profiles

  profiles(): Observable<ApiProfile[]> {
    return this.http.get<ApiProfile[]>(this.url('/me/profiles'));
  }

  createProfile(body: {
    name: string;
    kids?: boolean;
    pin?: string;
    avatarUrl?: string;
  }): Observable<ApiProfile> {
    return this.http.post<ApiProfile>(this.url('/me/profiles'), body);
  }

  deleteProfile(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/me/profiles/${id}`));
  }

  // ------------------------------------------------------------- watch & list

  watchlist(profileId?: string): Observable<ApiWatchlistEntry[]> {
    const params = profileId ? new HttpParams().set('profileId', profileId) : undefined;
    return this.http.get<ApiWatchlistEntry[]>(this.url('/me/watchlist'), { params });
  }

  addToWatchlist(showKey: string, profileId?: string): Observable<unknown> {
    return this.http.post<unknown>(this.url('/me/watchlist'), { showKey, profileId });
  }

  removeFromWatchlist(showKey: string, profileId?: string): Observable<void> {
    const params = profileId ? new HttpParams().set('profileId', profileId) : undefined;
    return this.http.delete<void>(this.url(`/me/watchlist/${encodeURIComponent(showKey)}`), {
      params,
    });
  }

  continueWatching(profileId?: string): Observable<ApiProgress[]> {
    const params = profileId ? new HttpParams().set('profileId', profileId) : undefined;
    return this.http.get<ApiProgress[]>(this.url('/me/continue-watching'), { params });
  }

  saveProgress(payload: ProgressPayload): Observable<ApiProgress> {
    return this.http.post<ApiProgress>(this.url('/me/progress'), payload);
  }

  deleteProgress(id: string, profileId?: string): Observable<void> {
    const params = profileId ? new HttpParams().set('profileId', profileId) : undefined;
    return this.http.delete<void>(this.url(`/me/continue-watching/${id}`), { params });
  }

  history(limit = 50, profileId?: string): Observable<ApiHistory[]> {
    let params = new HttpParams().set('limit', limit);
    if (profileId) params = params.set('profileId', profileId);
    return this.http.get<ApiHistory[]>(this.url('/me/history'), { params });
  }

  devices(): Observable<ApiDevice[]> {
    return this.http.get<ApiDevice[]>(this.url('/me/devices'));
  }

  revokeDevice(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/me/devices/${id}`));
  }

  // ---------------------------------------------------------- ratings/reviews

  rating(showKey: string): Observable<ApiRating> {
    return this.http.get<ApiRating>(this.url(`/shows/${encodeURIComponent(showKey)}/rating`));
  }

  myRating(showKey: string): Observable<ApiRating> {
    return this.http.get<ApiRating>(this.url(`/me/ratings/${encodeURIComponent(showKey)}`));
  }

  rate(showKey: string, score: number): Observable<ApiRating> {
    return this.http.put<ApiRating>(this.url(`/shows/${encodeURIComponent(showKey)}/rating`), {
      score,
    });
  }

  reviews(showKey: string): Observable<ApiReview[]> {
    return this.http.get<ApiReview[]>(this.url(`/shows/${encodeURIComponent(showKey)}/reviews`));
  }

  addReview(showKey: string, body: { title?: string; body: string; spoiler?: boolean }) {
    return this.http.post<ApiReview>(
      this.url(`/shows/${encodeURIComponent(showKey)}/reviews`),
      body,
    );
  }

  deleteReview(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/reviews/${id}`));
  }

  // ----------------------------------------------------------------- billing

  plans(): Observable<ApiPlan[]> {
    return this.http.get<ApiPlan[]>(this.url('/plans'));
  }

  subscription(): Observable<ApiSubscription | null> {
    return this.http.get<ApiSubscription | null>(this.url('/me/subscription'));
  }

  subscribe(planCode: string, gatewayReference?: string): Observable<ApiSubscription> {
    return this.http.post<ApiSubscription>(this.url('/me/subscription'), {
      planCode,
      gatewayReference,
    });
  }

  cancelSubscription(): Observable<void> {
    return this.http.post<void>(this.url('/me/subscription/cancel'), {});
  }

  payments(): Observable<ApiPayment[]> {
    return this.http.get<ApiPayment[]>(this.url('/me/payments'));
  }

  // ----------------------------------------------------------------- contact

  captcha(): Observable<CaptchaChallenge> {
    return this.http.get<CaptchaChallenge>(this.url('/contact/captcha'));
  }

  submitInquiry(body: {
    name: string;
    email: string;
    phone?: string;
    message: string;
    page?: string;
    captchaId: string;
    captchaCode: string;
  }): Observable<ApiInquiry> {
    return this.http.post<ApiInquiry>(this.url('/contact/inquiries'), body);
  }

}
