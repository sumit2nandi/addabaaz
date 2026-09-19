package in.addabaaz.billing.dto;

import java.time.Instant;

import in.addabaaz.billing.Subscription;

public record SubscriptionDto(
    java.util.UUID id,
    PlanDto plan,
    String status,
    Instant startedAt,
    Instant endsAt,
    boolean autoRenew,
    boolean current) {

  public static SubscriptionDto from(Subscription subscription) {
    return new SubscriptionDto(
        subscription.getId(),
        PlanDto.from(subscription.getPlan()),
        subscription.getStatus(),
        subscription.getStartedAt(),
        subscription.getEndsAt(),
        subscription.isAutoRenew(),
        subscription.isCurrent());
  }
}
