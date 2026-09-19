package in.addabaaz.engagement;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.common.NotFoundException;
import in.addabaaz.engagement.dto.DeviceDto;
import in.addabaaz.user.AppUser;
import jakarta.servlet.http.HttpServletRequest;

/** Tracks which devices an account has been used from; lets a user revoke them. */
@Service
@Transactional
public class DeviceService {

  private final DeviceSessionRepository devices;

  public DeviceService(DeviceSessionRepository devices) {
    this.devices = devices;
  }

  /** Called on every successful login — upserts a row for this user-agent. */
  public DeviceSession record(AppUser user, HttpServletRequest request) {
    if (request == null) {
      return null;
    }
    String userAgent = request.getHeader("User-Agent");
    String name = userAgent == null ? "Unknown device" : describe(userAgent);

    return devices.findAllByUserIdAndRevokedAtIsNullOrderByLastSeenAtDesc(user.getId()).stream()
        .filter(session -> java.util.Objects.equals(session.getUserAgent(), userAgent))
        .findFirst()
        .map(
            session -> {
              session.setLastSeenAt(Instant.now());
              return devices.save(session);
            })
        .orElseGet(
            () -> {
              DeviceSession session = new DeviceSession();
              session.setUser(user);
              session.setDeviceName(name);
              session.setUserAgent(userAgent);
              session.setIpAddress(request.getRemoteAddr());
              return devices.save(session);
            });
  }

  @Transactional(readOnly = true)
  public List<DeviceDto> list(AppUser user) {
    return devices.findAllByUserIdAndRevokedAtIsNullOrderByLastSeenAtDesc(user.getId()).stream()
        .map(DeviceDto::from)
        .toList();
  }

  public void revoke(AppUser user, UUID sessionId) {
    DeviceSession session =
        devices
            .findById(sessionId)
            .orElseThrow(() -> new NotFoundException("No such device session."));
    if (!session.getUser().getId().equals(user.getId())) {
      throw new NotFoundException("No such device session.");
    }
    session.setRevokedAt(Instant.now());
    devices.save(session);
  }

  private static String describe(String userAgent) {
    String lower = userAgent.toLowerCase();
    if (lower.contains("edg/")) {
      return "Edge";
    }
    if (lower.contains("chrome/")) {
      return "Chrome";
    }
    if (lower.contains("safari/") && !lower.contains("chrome")) {
      return "Safari";
    }
    if (lower.contains("firefox/")) {
      return "Firefox";
    }
    if (lower.contains("postman")) {
      return "Postman";
    }
    return "Unknown device";
  }
}
