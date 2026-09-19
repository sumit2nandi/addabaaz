package in.addabaaz.billing;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import in.addabaaz.billing.dto.PaymentDto;
import in.addabaaz.billing.dto.PlanDto;
import in.addabaaz.billing.dto.SubscriptionDto;
import in.addabaaz.security.AppUserDetails;

@RestController
@RequestMapping("/api")
@Validated
public class BillingController {

  private final BillingService billing;

  public BillingController(BillingService billing) {
    this.billing = billing;
  }

  /** Public: the pricing table. */
  @GetMapping("/plans")
  List<PlanDto> plans() {
    return billing.plans();
  }

  @GetMapping("/me/subscription")
  ResponseEntity<SubscriptionDto> subscription(@AuthenticationPrincipal AppUserDetails principal) {
    Optional<SubscriptionDto> current = billing.current(principal.getUser());
    return current.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
  }

  /** body: { "planCode": "MONTHLY", "gatewayReference": "pay_..." } */
  @PostMapping("/me/subscription")
  ResponseEntity<SubscriptionDto> subscribe(
      @AuthenticationPrincipal AppUserDetails principal,
      @RequestBody(required = false) Map<String, String> body) {
    String planCode = body == null ? null : body.get("planCode");
    if (planCode == null || planCode.isBlank()) {
      planCode = "MONTHLY";
    }
    String reference = body == null ? null : body.get("gatewayReference");
    return ResponseEntity.ok(billing.subscribe(principal.getUser(), planCode, reference));
  }

  @PostMapping("/me/subscription/cancel")
  ResponseEntity<Void> cancel(@AuthenticationPrincipal AppUserDetails principal) {
    billing.cancel(principal.getUser());
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/me/payments")
  List<PaymentDto> payments(@AuthenticationPrincipal AppUserDetails principal) {
    return billing.payments(principal.getUser());
  }
}
