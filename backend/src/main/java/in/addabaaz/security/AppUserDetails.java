package in.addabaaz.security;

import java.util.Collection;
import java.util.List;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import in.addabaaz.user.AppUser;
import in.addabaaz.user.Role;

/** Spring Security view of an {@link AppUser}. */
public class AppUserDetails implements UserDetails {

  private final AppUser user;

  public AppUserDetails(AppUser user) {
    this.user = user;
  }

  public AppUser getUser() {
    return user;
  }

  @Override
  public Collection<? extends GrantedAuthority> getAuthorities() {
    return user.getRoles().stream()
        .map(Role::getCode)
        .map(SimpleGrantedAuthority::new)
        .map(GrantedAuthority.class::cast)
        .toList();
  }

  @Override
  public String getPassword() {
    return user.getPasswordHash();
  }

  @Override
  public String getUsername() {
    return user.getEmail();
  }

  @Override
  public boolean isAccountNonExpired() {
    return user.getStatus() != AppUser.Status.DELETED;
  }

  @Override
  public boolean isAccountNonLocked() {
    return user.getStatus() != AppUser.Status.SUSPENDED;
  }

  @Override
  public boolean isCredentialsNonExpired() {
    return true;
  }

  @Override
  public boolean isEnabled() {
    return user.getStatus() == AppUser.Status.ACTIVE;
  }

  public static List<String> roles(AppUser user) {
    return user.getRoles().stream().map(Role::getCode).toList();
  }
}
