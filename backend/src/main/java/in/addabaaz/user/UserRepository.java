package in.addabaaz.user;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<AppUser, UUID> {

  Optional<AppUser> findByEmailIgnoreCase(String email);

  Optional<AppUser> findByAuthProviderAndProviderId(AppUser.AuthProvider provider, String providerId);

  boolean existsByEmailIgnoreCase(String email);
}
