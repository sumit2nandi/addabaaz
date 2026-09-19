package in.addabaaz.security;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import in.addabaaz.user.AppUser;
import in.addabaaz.user.UserRepository;

@Service
@Transactional(readOnly = true)
public class AppUserDetailsService implements UserDetailsService {

  private final UserRepository users;

  public AppUserDetailsService(UserRepository users) {
    this.users = users;
  }

  @Override
  public UserDetails loadUserByUsername(String email) {
    AppUser user =
        users
            .findByEmailIgnoreCase(email)
            .orElseThrow(() -> new UsernameNotFoundException("No such user: " + email));
    return new AppUserDetails(user);
  }
}
