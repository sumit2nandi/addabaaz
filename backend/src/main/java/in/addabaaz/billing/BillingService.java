package in.addabaaz.billing;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.billing.dto.PaymentDto;
import in.addabaaz.billing.dto.PlanDto;
import in.addabaaz.billing.dto.SubscriptionDto;
import in.addabaaz.common.BadRequestException;
import in.addabaaz.common.NotFoundException;
import in.addabaaz.user.AppUser;

/**
 * Plans, subscriptions and payments.
 *
 * <p>The gateway call is intentionally stubbed: {@code subscribe()} records a paid payment so the
 * whole flow can be exercised locally. Swap that block for a real Razorpay/Stripe verification
 * before going live.
 */
@Service
@Transactional
public class BillingService {

  private final PlanRepository plans;
  private final SubscriptionRepository subscriptions;
  private final PaymentRepository payments;

  public BillingService(
      PlanRepository plans, SubscriptionRepository subscriptions, PaymentRepository payments) {
    this.plans = plans;
    this.subscriptions = subscriptions;
    this.payments = payments;
  }

  @Transactional(readOnly = true)
  public List<PlanDto> plans() {
    return plans.findAllByActiveTrueOrderByPriceInrAsc().stream().map(PlanDto::from).toList();
  }

  @Transactional(readOnly = true)
  public Optional<SubscriptionDto> current(AppUser user) {
    return subscriptions
        .findTopByUserIdAndStatusOrderByEndsAtDesc(user.getId(), Subscription.Status.ACTIVE.name())
        .filter(Subscription::isCurrent)
        .map(SubscriptionDto::from);
  }

  public SubscriptionDto subscribe(AppUser user, String planCode, String gatewayReference) {
    Plan plan = plans.findByCode(planCode).orElseThrow(() -> new NotFoundException("No plan '" + planCode + "'."));
    if (!plan.isActive()) {
      throw new BadRequestException("That plan is no longer available.");
    }

    Instant now = Instant.now();
    subscriptions
        .findTopByUserIdAndStatusOrderByEndsAtDesc(user.getId(), Subscription.Status.ACTIVE.name())
        .ifPresent(
            active -> {
              active.setStatus(Subscription.Status.CANCELLED.name());
              active.setCancelledAt(now);
              subscriptions.save(active);
            });

    Subscription subscription = new Subscription();
    subscription.setUser(user);
    subscription.setPlan(plan);
    subscription.setStatus(Subscription.Status.ACTIVE.name());
    subscription.setStartedAt(now);
    subscription.setEndsAt(now.plusSeconds((long) plan.getDurationDays() * 86_400L));
    subscription.setAutoRenew(true);
    Subscription saved = subscriptions.save(subscription);

    Payment payment = new Payment();
    payment.setUser(user);
    payment.setSubscription(saved);
    payment.setAmount(plan.getPriceInr());
    payment.setCurrency(plan.getCurrency());
    payment.setGateway(gatewayReference == null ? "MANUAL" : "RAZORPAY");
    payment.setGatewayReference(gatewayReference);
    payment.setStatus(Payment.Status.PAID.name());
    payment.setPaidAt(now);
    payments.save(payment);

    return SubscriptionDto.from(saved);
  }

  public void cancel(AppUser user) {
    Subscription subscription =
        subscriptions
            .findTopByUserIdAndStatusOrderByEndsAtDesc(user.getId(), Subscription.Status.ACTIVE.name())
            .orElseThrow(() -> new NotFoundException("No active subscription."));
    subscription.setStatus(Subscription.Status.CANCELLED.name());
    subscription.setCancelledAt(Instant.now());
    subscription.setAutoRenew(false);
    subscriptions.save(subscription);
  }

  @Transactional(readOnly = true)
  public List<PaymentDto> payments(AppUser user) {
    return payments.findAllByUserIdOrderByCreatedAtDesc(user.getId()).stream()
        .map(PaymentDto::from)
        .toList();
  }
}
