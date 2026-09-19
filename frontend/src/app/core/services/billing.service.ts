import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { ApiPlan, ApiSubscription } from '../models/api';
import { ApiService } from './api.service';

/** Subscription plans and the current subscription of the signed-in account. */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly api = inject(ApiService);

  private readonly plansSignal = signal<ApiPlan[]>([]);
  private readonly currentSignal = signal<ApiSubscription | null>(null);

  readonly plans = this.plansSignal.asReadonly();
  readonly current = this.currentSignal.asReadonly();

  loadPlans(): void {
    this.api
      .plans()
      .subscribe({ next: (plans) => this.plansSignal.set(plans ?? []), error: () => undefined });
  }

  loadCurrent(): void {
    this.api
      .subscription()
      .subscribe({ next: (subscription) => this.currentSignal.set(subscription ?? null) });
  }

  subscribe(planCode: string): Observable<ApiSubscription> {
    return this.api.subscribe(planCode).pipe(tap((subscription) => this.currentSignal.set(subscription)));
  }
}
