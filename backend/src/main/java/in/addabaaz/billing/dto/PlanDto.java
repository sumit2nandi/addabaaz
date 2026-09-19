package in.addabaaz.billing.dto;

import java.math.BigDecimal;

import in.addabaaz.billing.Plan;

public record PlanDto(
    String code,
    String name,
    String description,
    BigDecimal priceInr,
    String currency,
    int durationDays,
    int maxScreens,
    String quality,
    boolean active) {

  public static PlanDto from(Plan plan) {
    return new PlanDto(
        plan.getCode(),
        plan.getName(),
        plan.getDescription(),
        plan.getPriceInr(),
        plan.getCurrency(),
        plan.getDurationDays(),
        plan.getMaxScreens(),
        plan.getQuality(),
        plan.isActive());
  }
}
