package in.addabaaz.config;

import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.billing.Subscription;
import in.addabaaz.billing.SubscriptionRepository;
import in.addabaaz.contact.CaptchaRepository;
import in.addabaaz.user.RefreshTokenRepository;

/** Housekeeping: expired CAPTCHAs, expired refresh tokens, lapsed subscriptions. */
@Component
@EnableScheduling
public class MaintenanceJob {

  private static final Logger log = LoggerFactory.getLogger(MaintenanceJob.class);

  private final CaptchaRepository captchas;
  private final RefreshTokenRepository refreshTokens;
  private final SubscriptionRepository subscriptions;

  public MaintenanceJob(
      CaptchaRepository captchas,
      RefreshTokenRepository refreshTokens,
      SubscriptionRepository subscriptions) {
    this.captchas = captchas;
    this.refreshTokens = refreshTokens;
    this.subscriptions = subscriptions;
  }

  @Transactional
  @Scheduled(fixedDelay = 30 * 60 * 1000L, initialDelay = 60_000L)
  public void cleanUp() {
    int removedCaptchas = captchas.deleteByExpiresAtBefore(Instant.now());
    int removedTokens = refreshTokens.deleteByExpiresAtBefore(Instant.now());

    Instant now = Instant.now();
    int expired =
        subscriptions.findAllByStatusAndEndsAtBefore(Subscription.Status.ACTIVE.name(), now).stream()
            .peek(
                subscription -> {
                  subscription.setStatus(Subscription.Status.EXPIRED.name());
                  subscriptions.save(subscription);
                })
            .toList()
            .size();

    if (removedCaptchas + removedTokens + expired > 0) {
      log.debug(
          "Maintenance: {} captchas, {} refresh tokens removed, {} subscriptions expired",
          removedCaptchas, removedTokens, expired);
    }
  }
}
