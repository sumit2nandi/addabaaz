package in.addabaaz.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import in.addabaaz.billing.Payment;

public record PaymentDto(
    UUID id,
    BigDecimal amount,
    String currency,
    String gateway,
    String gatewayReference,
    String status,
    Instant paidAt,
    Instant createdAt) {

  public static PaymentDto from(Payment payment) {
    return new PaymentDto(
        payment.getId(),
        payment.getAmount(),
        payment.getCurrency(),
        payment.getGateway(),
        payment.getGatewayReference(),
        payment.getStatus(),
        payment.getPaidAt(),
        payment.getCreatedAt());
  }
}
