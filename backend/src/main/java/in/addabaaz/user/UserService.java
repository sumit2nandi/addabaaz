package in.addabaaz.user;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.common.NotFoundException;

/** Account lookup helpers for the admin area. */
@Service
@Transactional(readOnly = true)
public class UserService {

  private final UserRepository users;
  private final AuthService authService;

  public UserService(UserRepository users, AuthService authService) {
    this.users = users;
    this.authService = authService;
  }

  @Transactional(readOnly = true)
  public List<AppUser> search(String query) {
    if (query == null || query.isBlank()) {
      return users.findAll();
    }
    String needle = query.trim().toLowerCase(Locale.ROOT);
    return users.findAll().stream()
        .filter(
            user ->
                (user.getEmail() != null && user.getEmail().toLowerCase(Locale.ROOT).contains(needle))
                    || (user.getFullName() != null
                        && user.getFullName().toLowerCase(Locale.ROOT).contains(needle)))
        .toList();
  }

  public void revokeSessions(UUID userId) {
    if (!users.existsById(userId)) {
      throw new NotFoundException("No such user.");
    }
    authService.revokeAllFor(userId);
  }
}
