package in.addabaaz.user;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

public interface RoleRepository extends JpaRepository<Role, Short> {

  Optional<Role> findByCode(String code);
}
