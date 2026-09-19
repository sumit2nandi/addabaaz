package in.addabaaz.engagement.dto;

import java.time.Instant;
import java.util.UUID;

import in.addabaaz.engagement.DeviceSession;

public record DeviceDto(
    UUID id, String deviceName, String ipAddress, Instant lastSeenAt, Instant createdAt) {

  public static DeviceDto from(DeviceSession session) {
    return new DeviceDto(
        session.getId(), session.getDeviceName(), session.getIpAddress(),
        session.getLastSeenAt(), session.getCreatedAt());
  }
}
