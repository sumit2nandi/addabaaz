package in.addabaaz.admin;

import java.util.List;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import in.addabaaz.admin.dto.AdminRequests;
import in.addabaaz.common.NotFoundException;
import in.addabaaz.user.AppUser;
import in.addabaaz.user.Role;
import in.addabaaz.user.RoleRepository;
import in.addabaaz.user.UserRepository;
import in.addabaaz.user.UserService;
import in.addabaaz.user.dto.UserDto;

/** Account administration: list users, grant/revoke admin, suspend, watchlist overview. */
@RestController
@RequestMapping("/api/admin/users")
@Validated
public class AdminUserController {

  private final UserRepository users;
  private final RoleRepository roles;
  private final UserService userService;

  public AdminUserController(UserRepository users, RoleRepository roles, UserService userService) {
    this.users = users;
    this.roles = roles;
    this.userService = userService;
  }

  @GetMapping
  List<UserDto> list(@RequestParam(required = false) String query) {
    return userService.search(query).stream().map(UserDto::from).toList();
  }

  @GetMapping("/{id}")
  UserDto one(@PathVariable UUID id) {
    return UserDto.from(
        users.findById(id).orElseThrow(() -> new NotFoundException("No such user.")));
  }

  /** body: { "admin": true|false, "suspended": true|false, "status": "ACTIVE" } */
  @PatchMapping("/{id}")
  @Transactional
  ResponseEntity<UserDto> update(
      @PathVariable UUID id, @RequestBody(required = false) AdminRequests.UserStatusRequest request) {
    AppUser user = users.findById(id).orElseThrow(() -> new NotFoundException("No such user."));

    if (request != null) {
      if (Boolean.TRUE.equals(request.suspended())) {
        user.setStatus(AppUser.Status.SUSPENDED);
      } else if (Boolean.FALSE.equals(request.suspended())) {
        user.setStatus(AppUser.Status.ACTIVE);
      }
      if (request.status() != null && !request.status().isBlank()) {
        user.setStatus(AppUser.Status.valueOf(request.status().toUpperCase()));
      }
      if (request.admin() != null) {
        Role adminRole =
            roles
                .findByCode("ROLE_ADMIN")
                .orElseThrow(() -> new NotFoundException("Run V3__seed_ott.sql — no ROLE_ADMIN."));
        if (Boolean.TRUE.equals(request.admin())) {
          user.getRoles().add(adminRole);
        } else {
          user.getRoles().removeIf(role -> "ROLE_ADMIN".equals(role.getCode()));
        }
      }
    }

    return ResponseEntity.ok(UserDto.from(users.save(user)));
  }

  @PostMapping("/{id}/revoke-sessions")
  ResponseEntity<Void> revokeSessions(@PathVariable UUID id) {
    userService.revokeSessions(id);
    return ResponseEntity.noContent().build();
  }
}
