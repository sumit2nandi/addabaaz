package in.addabaaz.catalog.dto;

import in.addabaaz.catalog.ServiceItem;

public record ServiceDto(String num, String title, String description) {

  public static ServiceDto from(ServiceItem service) {
    return new ServiceDto(service.getNum(), service.getTitle(), service.getDescription());
  }
}
